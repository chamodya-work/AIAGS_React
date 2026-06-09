import json
import os
import re
import csv
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel

import ollama

load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

app = FastAPI(title="AIAGS ML Service", version="2.0")


def _env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name, str(default))
    clean_value = raw_value.split("#", 1)[0].strip()
    try:
        return int(clean_value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer value, got {raw_value!r}") from exc


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", os.getenv("AIAGS_OLLAMA_MODEL", "llama3.1:8b"))

print(f"Using Ollama model: {OLLAMA_MODEL}")

OLLAMA_TIMEOUT_SECONDS = _env_int("OLLAMA_TIMEOUT_SECONDS", 120)
MAX_EXTRACTED_CHARS = _env_int("MAX_EXTRACTED_CHARS", 30000)

RUBRIC_EXTENSIONS = {".xlsx", ".xls", ".csv", ".pdf", ".docx"}
SUBMISSION_EXTENSIONS = {".pdf", ".docx"}
UNSUPPORTED_FILE_MESSAGE = (
    "Unsupported file type. Please upload rubric as Excel/PDF/DOCX and assignment submission as PDF or DOCX."
)
DOC_UNSUPPORTED_MESSAGE = "DOC files are not supported. Please convert the document to DOCX or PDF and upload again."
PDF_TEXT_UNREADABLE_MESSAGE = (
    "PDF text could not be extracted. The file may be scanned or image-based. "
    "Please upload a text-based PDF or DOCX."
)


class AssignmentInfo(BaseModel):
    assignment_id: int
    assignment_name: str
    course_name: Optional[str] = None
    batch: Optional[str] = None
    department: Optional[str] = None
    start_date: Optional[str] = None
    deadline_date: Optional[str] = None
    remark: Optional[str] = None


class StudentInfo(BaseModel):
    student_no: str


class RubricInfo(BaseModel):
    rubric_id: int
    rubric_name: Optional[str] = None
    rubric_text: Optional[str] = None
    file_path: Optional[str] = None
    file_mime: Optional[str] = None
    file_original_name: Optional[str] = None


class SubmissionFileInfo(BaseModel):
    file_id: Optional[int] = None
    file_path: str
    file_original_name: Optional[str] = None
    file_mime: Optional[str] = None
    required_document_name: Optional[str] = None


class SubmissionInfo(BaseModel):
    portfolio_id: int
    file_path: str
    portfolio_link: Optional[str] = None
    uploaded_at: Optional[str] = None
    files: Optional[List[SubmissionFileInfo]] = None


class GradeRequest(BaseModel):
    portfolio_id: int
    assignment: AssignmentInfo
    student: StudentInfo
    rubric: RubricInfo
    submission: SubmissionInfo


class GradeResponse(BaseModel):
    portfolio_id: int
    status: str
    ai_grade: Optional[float] = None
    ai_report_text: Optional[str] = None
    ai_model: str
    error: Optional[str] = None


class FeedbackResponse(BaseModel):
    portfolio_id: int
    status: str
    feedback_text: Optional[str] = None
    ai_model: str
    error: Optional[str] = None


REQUIRED_KEYS = [
    "score",
    "overall_evaluation",
    "strengths",
    "areas_for_improvement",
    "suggestions_for_improvement",
    "overall_comment",
]

FEEDBACK_REQUIRED_KEYS = [
    "overall_feedback",
    "main_improvement_areas",
    "practical_suggestions",
    "final_advice",
]

UNSAFE_FEEDBACK_PATTERNS = [
    r"\bscore\b",
    r"\bgrade\b",
    r"\bmarks?\b",
    r"\bpoints?\b",
    r"\brubric\b",
    r"\bcriteria?\b",
    r"\bcriterion\b",
    r"\bawarded\b",
    r"\bgrading\b",
    r"\b\d{1,3}\s*(/|out of)\s*100\b",
    r"\b\d{1,3}\s*%\b",
]

FEEDBACK_SAFE_FALLBACKS = {
    "overall_feedback": "Your submission has been reviewed for learning support. Focus on making your explanation clearer, more complete, and easier to follow.",
    "main_improvement_areas": "Improve clarity, organization, evidence, and completeness in the main sections of your work.",
    "practical_suggestions": "Review each section, add clearer explanations, support important statements, and check formatting before submitting again.",
    "final_advice": "Revise your work carefully and use this feedback to strengthen your submission before official evaluation.",
}


def _truncate(text: str) -> str:
    text = (text or "").strip()
    if len(text) <= MAX_EXTRACTED_CHARS:
        return text
    return text[:MAX_EXTRACTED_CHARS] + "\n\n[Content truncated for AI processing.]"


def _format_table(title: str, rows: List[List[Any]]) -> str:
    cleaned_rows: List[List[str]] = []
    for row in rows:
        cleaned = [str(cell).strip() if cell is not None else "" for cell in row]
        if any(cleaned):
            cleaned_rows.append(cleaned)

    if not cleaned_rows:
        return ""

    max_cols = max(len(row) for row in cleaned_rows)
    lines = [title]
    for idx, row in enumerate(cleaned_rows, start=1):
        normalized = row + [""] * (max_cols - len(row))
        lines.append(f"Row {idx}: " + " | ".join(normalized))
    return "\n".join(lines)


def _extract_pdf_text(file_path: str) -> str:
    text_parts: List[str] = []
    try:
        import pdfplumber
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    text_parts.append(page_text.strip())
    except Exception:
        text_parts = []

    if not text_parts:
        try:
            import fitz
            doc = fitz.open(file_path)
            for page in doc:
                page_text = page.get_text("text") or ""
                if page_text.strip():
                    text_parts.append(page_text.strip())
        except Exception:
            text_parts = []

    text = "\n".join(text_parts).strip()
    if not text:
        raise ValueError(PDF_TEXT_UNREADABLE_MESSAGE)
    return _truncate(text)


def _extract_docx_text(file_path: str) -> str:
    try:
        from docx import Document
        doc = Document(file_path)
        text_parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
        for table_index, table in enumerate(doc.tables, start=1):
            rows = []
            for row in table.rows:
                rows.append([cell.text.replace("\n", " ").strip() for cell in row.cells])
            table_text = _format_table(f"TABLE {table_index}:", rows)
            if table_text:
                text_parts.append(table_text)
        text = "\n".join(text_parts).strip()
    except Exception as exc:
        raise ValueError("Could not read DOCX content.") from exc

    if not text:
        raise ValueError("No readable text found in DOCX file.")
    return _truncate(text)


def _extract_xlsx_text(file_path: str) -> str:
    try:
        from openpyxl import load_workbook
        workbook = load_workbook(file_path, read_only=True, data_only=True)
        parts = []
        for sheet in workbook.worksheets:
            rows = [[cell for cell in row] for row in sheet.iter_rows(values_only=True)]
            table_text = _format_table(f"SHEET: {sheet.title}", rows)
            if table_text:
                parts.append(table_text)
        workbook.close()
    except Exception as exc:
        raise ValueError("Could not read Excel rubric content.") from exc

    text = "\n\n".join(parts).strip()
    if not text:
        raise ValueError("No readable text found in Excel rubric.")
    return _truncate(text)


def _extract_xls_text(file_path: str) -> str:
    try:
        import pandas as pd
        sheets = pd.read_excel(file_path, sheet_name=None, header=None, dtype=str, engine="xlrd")
        parts = []
        for sheet_name, frame in sheets.items():
            frame = frame.dropna(how="all").dropna(axis=1, how="all")
            rows = frame.where(pd.notna(frame), None).values.tolist()
            table_text = _format_table(f"SHEET: {sheet_name}", rows)
            if table_text:
                parts.append(table_text)
    except Exception as exc:
        raise ValueError("Could not read Excel rubric content.") from exc

    text = "\n\n".join(parts).strip()
    if not text:
        raise ValueError("No readable text found in Excel rubric.")
    return _truncate(text)


def _extract_csv_text(file_path: str) -> str:
    last_error: Optional[Exception] = None
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with open(file_path, newline="", encoding=encoding) as f:
                rows = list(csv.reader(f))
            text = _format_table("CSV RUBRIC:", rows).strip()
            if not text:
                raise ValueError("No readable text found in CSV rubric.")
            return _truncate(text)
        except Exception as exc:
            last_error = exc
    raise ValueError("Could not read CSV rubric content.") from last_error


def extract_text(file_path: Optional[str], label: str, allowed_extensions: Set[str]) -> str:
    if not file_path:
        raise ValueError(f"{label} file path is missing.")
    if not os.path.exists(file_path):
        raise ValueError(f"{label} file was not found.")

    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".doc":
        raise ValueError(DOC_UNSUPPORTED_MESSAGE)

    if ext not in allowed_extensions:
        raise ValueError(UNSUPPORTED_FILE_MESSAGE)

    if ext == ".pdf":
        return _extract_pdf_text(file_path)

    if ext == ".docx":
        return _extract_docx_text(file_path)

    if ext == ".xlsx":
        return _extract_xlsx_text(file_path)

    if ext == ".xls":
        return _extract_xls_text(file_path)

    if ext == ".csv":
        return _extract_csv_text(file_path)

    raise ValueError(UNSUPPORTED_FILE_MESSAGE)


def extract_rubric_file_text(file_path: str) -> str:
    filename = os.path.basename(file_path)
    content = extract_text(file_path, "rubric", RUBRIC_EXTENSIONS)
    return f"RUBRIC FILE: {filename}\n{content}"


def extract_submission_file_text(file_path: str, index: int = 1) -> str:
    filename = os.path.basename(file_path)
    content = extract_text(file_path, "student submission", SUBMISSION_EXTENSIONS)
    return f"FILE {index}: {filename}\n{content}"


def submission_content(req: GradeRequest) -> str:
    parts: List[str] = []
    seen_paths: Set[str] = set()
    files = req.submission.files or []

    for index, file_info in enumerate(files, start=1):
        if not file_info.file_path or file_info.file_path in seen_paths:
            continue
        seen_paths.add(file_info.file_path)
        heading = extract_submission_file_text(file_info.file_path, index)
        if file_info.required_document_name:
            heading = f"REQUIRED DOCUMENT: {file_info.required_document_name}\n{heading}"
        parts.append(heading)

    if not parts and req.submission.file_path:
        parts.append(extract_submission_file_text(req.submission.file_path))

    text = "\n\n".join(parts).strip()
    if not text:
        raise ValueError("Student submission content is missing or unreadable.")
    return _truncate(text)


def rubric_content(req: GradeRequest) -> str:
    parts = []
    if req.rubric.rubric_text and req.rubric.rubric_text.strip():
        parts.append(req.rubric.rubric_text.strip())
    if req.rubric.file_path:
        parts.append(extract_rubric_file_text(req.rubric.file_path))

    text = "\n\n".join(parts).strip()
    if not text:
        raise ValueError("Rubric content is missing or unreadable.")
    return _truncate(text)


def _build_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None) -> str:
    correction_block = ""
    if correction:
        correction_block = f"""
The previous response was invalid for this reason:
{correction}

Return corrected JSON only.
"""

    return f"""
You are an academic assignment evaluation assistant for lecturers and heads of department.
Evaluate the student submission using the uploaded assignment rubric internally.
Do not copy the full rubric into the report.

Assignment:
- Name: {req.assignment.assignment_name}
- Course: {req.assignment.course_name or "Not specified"}
- Batch: {req.assignment.batch or "Not specified"}
- Department: {req.assignment.department or "Not specified"}

Student Number: {req.student.student_no}

Rubric content:
\"\"\"
{rubric_text}
\"\"\"

Student submission content:
\"\"\"
{submission_text}
\"\"\"

Return ONLY one valid JSON object with this exact shape:
{{
  "score": 0,
  "overall_evaluation": "Professional summary of submission quality.",
  "strengths": ["Strength 1", "Strength 2"],
  "areas_for_improvement": ["Issue 1", "Issue 2"],
  "suggestions_for_improvement": ["Suggestion 1", "Suggestion 2"],
  "overall_comment": "Final professional evaluation comment."
}}

Rules:
- score must be a number from 0 to 100.
- Base the evaluation on the rubric and submission.
- Do not expose exact rubric marks, hidden grading logic, or raw rubric criteria.
- Keep the report professional and useful for lecturer/head evaluation.
- Do not include markdown fences.
- Do not include text outside the JSON object.
{correction_block}
"""


def _build_feedback_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None) -> str:
    correction_block = ""
    if correction:
        correction_block = f"""
The previous response was unsafe or invalid for this reason:
{correction}

Return corrected JSON only.
"""

    return f"""
You are a helpful academic writing assistant giving private learning feedback to a student.
Use the assignment details, uploaded rubric, and student submission internally only.
Do not reveal the rubric, rubric criteria, hidden grading logic, marks, score, grade, awarded marks, or grading breakdown.

Assignment:
- Name: {req.assignment.assignment_name}
- Course: {req.assignment.course_name or "Not specified"}
- Batch: {req.assignment.batch or "Not specified"}
- Department: {req.assignment.department or "Not specified"}

Student submission content:
\"\"\"
{submission_text}
\"\"\"

Internal rubric content. Use it only to guide improvement advice. Do not mention or quote it:
\"\"\"
{rubric_text}
\"\"\"

Return ONLY one valid JSON object with this exact shape:
{{
  "overall_feedback": "Simple, helpful summary of the submission.",
  "main_improvement_areas": ["Area 1", "Area 2"],
  "practical_suggestions": ["Suggestion 1", "Suggestion 2"],
  "final_advice": "Encouraging final advice for improving before official evaluation."
}}

Rules:
- Do not mention score, grade, marks, points, percentages, rubric, criteria, awarded marks, or grading breakdown.
- Give only improvement advice.
- Write in simple, student-friendly language.
- Do not include markdown fences.
- Do not include text outside the JSON object.
{correction_block}
"""


def _extract_first_json(raw_output: str) -> Dict[str, Any]:
    raw_output = (raw_output or "").strip()
    if not raw_output:
        raise ValueError("Model returned empty output.")

    if "```" in raw_output:
        parts = raw_output.split("```")
        candidates = [p for p in parts if "{" in p]
        if candidates:
            raw_output = candidates[0].strip()
            if raw_output.lower().startswith("json"):
                raw_output = raw_output[4:].strip()

    try:
        return json.loads(raw_output)
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for i, ch in enumerate(raw_output):
        if ch == "{":
            try:
                obj, _ = decoder.raw_decode(raw_output[i:])
                return obj
            except json.JSONDecodeError:
                continue

    raise ValueError("Model did not return a valid JSON object.")


def _validate_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(obj, dict):
        raise ValueError("Model output is not an object.")

    missing = [key for key in REQUIRED_KEYS if key not in obj]
    if missing:
        raise ValueError(f"Model output is missing keys: {', '.join(missing)}")

    score = float(obj["score"])
    if score < 0 or score > 100:
        raise ValueError("Model score is outside the valid 0-100 range.")

    for key in REQUIRED_KEYS[1:]:
        value = obj.get(key)
        if isinstance(value, list):
            if not any(str(item).strip() for item in value):
                raise ValueError(f"Model output section is empty: {key}")
        elif not str(value or "").strip():
            raise ValueError(f"Model output section is empty: {key}")

    obj["score"] = round(score, 2)
    return obj


def _feedback_text_has_unsafe_content(text: str) -> Optional[str]:
    text = text or ""
    for pattern in UNSAFE_FEEDBACK_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return pattern
    return None


def _sanitize_feedback_text_value(value: Any, fallback: str) -> str:
    text = str(value or "").replace("\r", "\n").strip()
    if not text:
        return fallback

    safe_segments: List[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip(" -\t")
        if not line:
            continue

        # Keep safe sentences and drop any sentence that mentions restricted grading/rubric language.
        for segment in re.split(r"(?<=[.!?])\s+", line):
            segment = segment.strip(" -\t")
            if segment and not _feedback_text_has_unsafe_content(segment):
                safe_segments.append(segment)

    clean = " ".join(safe_segments).strip()
    return clean or fallback


def _sanitize_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
    sanitized: Dict[str, Any] = {}
    for key in FEEDBACK_REQUIRED_KEYS:
        fallback = FEEDBACK_SAFE_FALLBACKS[key]
        value = obj.get(key)

        if isinstance(value, list):
            items = [
                _sanitize_feedback_text_value(item, "")
                for item in value
            ]
            sanitized[key] = [item for item in items if item] or [fallback]
        else:
            sanitized[key] = _sanitize_feedback_text_value(value, fallback)

    return sanitized


def _validate_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(obj, dict):
        raise ValueError("Model output is not an object.")

    if not any(str(obj.get(key) or "").strip() for key in FEEDBACK_REQUIRED_KEYS):
        raise ValueError("Model output did not include usable feedback sections.")

    sanitized = _sanitize_feedback_structured(obj)
    rendered = _render_feedback(sanitized)
    unsafe = _feedback_text_has_unsafe_content(rendered)
    if unsafe:
        raise ValueError("Sanitized feedback still contained restricted grading or rubric language.")

    return sanitized


def _call_ollama(prompt: str) -> Dict[str, Any]:
    client = ollama.Client(host=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT_SECONDS)
    response = client.chat(
        model=OLLAMA_MODEL,
        messages=[{"role": "user", "content": prompt}],
        stream=False,
    )
    raw_output = response["message"]["content"]
    return _extract_first_json(raw_output)


def _as_bullets(value: Any) -> str:
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
    else:
        items = [line.strip("- ").strip() for line in str(value).splitlines() if line.strip()]

    if not items:
        return "-"
    return "\n".join(f"- {item}" for item in items)


def _render_report(req: GradeRequest, structured: Dict[str, Any]) -> str:
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    return f"""AI Assignment Evaluation Report

Student Number: {req.student.student_no}
Assignment: {req.assignment.assignment_name}
Course: {req.assignment.course_name or "Not specified"}
Generated Date: {generated_at}

1. Overall Evaluation
{structured["overall_evaluation"]}

2. Strengths of the Submission
{_as_bullets(structured["strengths"])}

3. Areas That Need Improvement
{_as_bullets(structured["areas_for_improvement"])}

4. Suggestions for Improvement
{_as_bullets(structured["suggestions_for_improvement"])}

5. Overall Comment
{structured["overall_comment"]}
"""


def _render_feedback(structured: Dict[str, Any]) -> str:
    return f"""AI Learning Feedback Report

1. Overall Feedback
{structured["overall_feedback"]}

2. Main Improvement Areas
{_as_bullets(structured["main_improvement_areas"])}

3. Practical Suggestions
{_as_bullets(structured["practical_suggestions"])}

4. Final Advice
{structured["final_advice"]}
"""


def _validate_report_text(report: str) -> None:
    if not report.strip():
        raise ValueError("Generated report is empty.")
    required_sections = [
        "AI Assignment Evaluation Report",
        "1. Overall Evaluation",
        "2. Strengths of the Submission",
        "3. Areas That Need Improvement",
        "4. Suggestions for Improvement",
        "5. Overall Comment",
    ]
    missing = [section for section in required_sections if section not in report]
    if missing:
        raise ValueError(f"Generated report is missing sections: {', '.join(missing)}")


def _validate_feedback_text(feedback: str) -> None:
    if not feedback.strip():
        raise ValueError("Generated feedback is empty.")
    required_sections = [
        "AI Learning Feedback Report",
        "1. Overall Feedback",
        "2. Main Improvement Areas",
        "3. Practical Suggestions",
        "4. Final Advice",
    ]
    missing = [section for section in required_sections if section not in feedback]
    if missing:
        raise ValueError(f"Generated feedback is missing sections: {', '.join(missing)}")
    if _feedback_text_has_unsafe_content(feedback):
        raise ValueError("Generated feedback contained restricted grading or rubric language.")


@app.get("/health")
def health():
    return {
        "ok": True,
        "ollama_base_url": OLLAMA_BASE_URL,
        "ollama_model": OLLAMA_MODEL,
    }


@app.post("/grade", response_model=GradeResponse)
def grade(req: GradeRequest):
    try:
        rubric_text = rubric_content(req)
        submission_text = submission_content(req)

        first_error = None
        structured = None

        for attempt in range(2):
            try:
                prompt = _build_prompt(
                    req,
                    rubric_text,
                    submission_text,
                    correction=str(first_error) if attempt == 1 and first_error else None,
                )
                structured = _validate_structured(_call_ollama(prompt))
                break
            except Exception as exc:
                first_error = exc
                if attempt == 1:
                    raise

        if structured is None:
            raise ValueError("LLM did not return valid grading output.")

        report = _render_report(req, structured)
        _validate_report_text(report)

        return GradeResponse(
            portfolio_id=req.portfolio_id,
            status="graded",
            ai_grade=structured["score"],
            ai_report_text=report,
            ai_model=OLLAMA_MODEL,
        )
    except Exception as exc:
        return GradeResponse(
            portfolio_id=req.portfolio_id,
            status="failed",
            ai_grade=None,
            ai_report_text=None,
            ai_model=OLLAMA_MODEL,
            error=str(exc),
        )


@app.post("/feedback", response_model=FeedbackResponse)
def feedback(req: GradeRequest):
    try:
        rubric_text = rubric_content(req)
        submission_text = submission_content(req)

        first_error = None
        structured = None

        for attempt in range(2):
            try:
                prompt = _build_feedback_prompt(
                    req,
                    rubric_text,
                    submission_text,
                    correction=str(first_error) if attempt == 1 and first_error else None,
                )
                structured = _validate_feedback_structured(_call_ollama(prompt))
                break
            except Exception as exc:
                first_error = exc
                if attempt == 1:
                    raise

        if structured is None:
            raise ValueError("LLM did not return valid feedback output.")

        feedback_text = _render_feedback(structured)
        _validate_feedback_text(feedback_text)

        return FeedbackResponse(
            portfolio_id=req.portfolio_id,
            status="completed",
            feedback_text=feedback_text,
            ai_model=OLLAMA_MODEL,
        )
    except Exception as exc:
        return FeedbackResponse(
            portfolio_id=req.portfolio_id,
            status="failed",
            feedback_text=None,
            ai_model=OLLAMA_MODEL,
            error=str(exc),
        )
