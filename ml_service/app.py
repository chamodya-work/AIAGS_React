import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

import ollama

app = FastAPI(title="AIAGS ML Service", version="2.0")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", os.getenv("AIAGS_OLLAMA_MODEL", "llama3.1:8b"))
OLLAMA_TIMEOUT_SECONDS = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))
MAX_EXTRACTED_CHARS = int(os.getenv("MAX_EXTRACTED_CHARS", "30000"))


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


class SubmissionInfo(BaseModel):
    portfolio_id: int
    file_path: str
    portfolio_link: Optional[str] = None
    uploaded_at: Optional[str] = None


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


REQUIRED_KEYS = [
    "score",
    "overall_evaluation",
    "strengths",
    "areas_for_improvement",
    "suggestions_for_improvement",
    "overall_comment",
]


def _truncate(text: str) -> str:
    text = (text or "").strip()
    if len(text) <= MAX_EXTRACTED_CHARS:
        return text
    return text[:MAX_EXTRACTED_CHARS] + "\n\n[Content truncated for AI processing.]"


def extract_text(file_path: Optional[str], label: str) -> str:
    if not file_path:
        raise ValueError(f"{label} file path is missing.")
    if not os.path.exists(file_path):
        raise ValueError(f"{label} file was not found.")

    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
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
            except Exception as exc:
                raise ValueError(f"Could not read {label} PDF content.") from exc

        text = "\n".join(text_parts).strip()
        if not text:
            raise ValueError(f"No readable text found in {label} PDF.")
        return _truncate(text)

    if ext == ".docx":
        try:
            from docx import Document
            doc = Document(file_path)
            text_parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text and cell.text.strip():
                            text_parts.append(cell.text.strip())
            text = "\n".join(text_parts).strip()
        except Exception as exc:
            raise ValueError(f"Could not read {label} DOCX content.") from exc

        if not text:
            raise ValueError(f"No readable text found in {label} DOCX.")
        return _truncate(text)

    if ext == ".txt":
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read().strip()
        except Exception as exc:
            raise ValueError(f"Could not read {label} TXT content.") from exc

        if not text:
            raise ValueError(f"No readable text found in {label} TXT.")
        return _truncate(text)

    if ext == ".doc":
        raise ValueError(f"{label} DOC files are not supported. Please upload DOCX, PDF, or TXT.")

    raise ValueError(f"{label} file type '{ext or 'unknown'}' is not supported.")


def rubric_content(req: GradeRequest) -> str:
    parts = []
    if req.rubric.rubric_text and req.rubric.rubric_text.strip():
      parts.append(req.rubric.rubric_text.strip())
    if req.rubric.file_path:
      parts.append(extract_text(req.rubric.file_path, "rubric"))

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
        submission_text = extract_text(req.submission.file_path, "student submission")

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
