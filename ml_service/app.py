# import json
# import os
# import re
# import csv
# from datetime import datetime
# from pathlib import Path
# from typing import Any, Dict, List, Optional, Set

# from dotenv import load_dotenv
# from fastapi import FastAPI
# from pydantic import BaseModel

# import ollama

# load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

# app = FastAPI(title="AIAGS ML Service", version="2.0")


# def _env_int(name: str, default: int) -> int:
#     raw_value = os.getenv(name, str(default))
#     clean_value = raw_value.split("#", 1)[0].strip()
#     try:
#         return int(clean_value)
#     except ValueError as exc:
#         raise ValueError(f"{name} must be an integer value, got {raw_value!r}") from exc


# OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
# OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", os.getenv("AIAGS_OLLAMA_MODEL", "llama3.1:8b"))

# print(f"Using Ollama model: {OLLAMA_MODEL}")

# OLLAMA_TIMEOUT_SECONDS = _env_int("OLLAMA_TIMEOUT_SECONDS", 120)
# MAX_EXTRACTED_CHARS = _env_int("MAX_EXTRACTED_CHARS", 30000)

# RUBRIC_EXTENSIONS = {".xlsx", ".xls", ".csv", ".pdf", ".docx"}
# SUBMISSION_EXTENSIONS = {".pdf", ".docx"}
# UNSUPPORTED_FILE_MESSAGE = (
#     "Unsupported file type. Please upload rubric as Excel/PDF/DOCX and assignment submission as PDF or DOCX."
# )
# DOC_UNSUPPORTED_MESSAGE = "DOC files are not supported. Please convert the document to DOCX or PDF and upload again."
# PDF_TEXT_UNREADABLE_MESSAGE = (
#     "PDF text could not be extracted. The file may be scanned or image-based. "
#     "Please upload a text-based PDF or DOCX."
# )


# class AssignmentInfo(BaseModel):
#     assignment_id: int
#     assignment_name: str
#     course_name: Optional[str] = None
#     batch: Optional[str] = None
#     department: Optional[str] = None
#     start_date: Optional[str] = None
#     deadline_date: Optional[str] = None
#     remark: Optional[str] = None


# class StudentInfo(BaseModel):
#     student_no: str


# class RubricInfo(BaseModel):
#     rubric_id: int
#     rubric_name: Optional[str] = None
#     rubric_text: Optional[str] = None
#     file_path: Optional[str] = None
#     file_mime: Optional[str] = None
#     file_original_name: Optional[str] = None


# class SubmissionFileInfo(BaseModel):
#     file_id: Optional[int] = None
#     file_path: str
#     file_original_name: Optional[str] = None
#     file_mime: Optional[str] = None
#     required_document_name: Optional[str] = None


# class SubmissionInfo(BaseModel):
#     portfolio_id: int
#     file_path: str
#     portfolio_link: Optional[str] = None
#     uploaded_at: Optional[str] = None
#     files: Optional[List[SubmissionFileInfo]] = None


# class GradeRequest(BaseModel):
#     portfolio_id: int
#     assignment: AssignmentInfo
#     student: StudentInfo
#     rubric: RubricInfo
#     submission: SubmissionInfo


# class GradeResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     ai_grade: Optional[float] = None
#     ai_report_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None


# class FeedbackResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     feedback_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None


# REQUIRED_KEYS = [
#     "score",
#     "overall_evaluation",
#     "strengths",
#     "areas_for_improvement",
#     "suggestions_for_improvement",
#     "overall_comment",
# ]

# FEEDBACK_REQUIRED_KEYS = [
#     "overall_feedback",
#     "main_improvement_areas",
#     "practical_suggestions",
#     "final_advice",
# ]

# UNSAFE_FEEDBACK_PATTERNS = [
#     r"\bscore\b",
#     r"\bgrade\b",
#     r"\bmarks?\b",
#     r"\bpoints?\b",
#     r"\brubric\b",
#     r"\bcriteria?\b",
#     r"\bcriterion\b",
#     r"\bawarded\b",
#     r"\bgrading\b",
#     r"\b\d{1,3}\s*(/|out of)\s*100\b",
#     r"\b\d{1,3}\s*%\b",
# ]

# FEEDBACK_SAFE_FALLBACKS = {
#     "overall_feedback": "Your submission has been reviewed for learning support. Focus on making your explanation clearer, more complete, and easier to follow.",
#     "main_improvement_areas": "Improve clarity, organization, evidence, and completeness in the main sections of your work.",
#     "practical_suggestions": "Review each section, add clearer explanations, support important statements, and check formatting before submitting again.",
#     "final_advice": "Revise your work carefully and use this feedback to strengthen your submission before official evaluation.",
# }


# def _truncate(text: str) -> str:
#     text = (text or "").strip()
#     if len(text) <= MAX_EXTRACTED_CHARS:
#         return text
#     return text[:MAX_EXTRACTED_CHARS] + "\n\n[Content truncated for AI processing.]"


# def _format_table(title: str, rows: List[List[Any]]) -> str:
#     cleaned_rows: List[List[str]] = []
#     for row in rows:
#         cleaned = [str(cell).strip() if cell is not None else "" for cell in row]
#         if any(cleaned):
#             cleaned_rows.append(cleaned)

#     if not cleaned_rows:
#         return ""

#     max_cols = max(len(row) for row in cleaned_rows)
#     lines = [title]
#     for idx, row in enumerate(cleaned_rows, start=1):
#         normalized = row + [""] * (max_cols - len(row))
#         lines.append(f"Row {idx}: " + " | ".join(normalized))
#     return "\n".join(lines)


# def _extract_pdf_text(file_path: str) -> str:
#     text_parts: List[str] = []
#     try:
#         import pdfplumber
#         with pdfplumber.open(file_path) as pdf:
#             for page in pdf.pages:
#                 page_text = page.extract_text() or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#     except Exception:
#         text_parts = []

#     if not text_parts:
#         try:
#             import fitz
#             doc = fitz.open(file_path)
#             for page in doc:
#                 page_text = page.get_text("text") or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#         except Exception:
#             text_parts = []

#     text = "\n".join(text_parts).strip()
#     if not text:
#         raise ValueError(PDF_TEXT_UNREADABLE_MESSAGE)
#     return _truncate(text)


# def _extract_docx_text(file_path: str) -> str:
#     try:
#         from docx import Document
#         doc = Document(file_path)
#         text_parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
#         for table_index, table in enumerate(doc.tables, start=1):
#             rows = []
#             for row in table.rows:
#                 rows.append([cell.text.replace("\n", " ").strip() for cell in row.cells])
#             table_text = _format_table(f"TABLE {table_index}:", rows)
#             if table_text:
#                 text_parts.append(table_text)
#         text = "\n".join(text_parts).strip()
#     except Exception as exc:
#         raise ValueError("Could not read DOCX content.") from exc

#     if not text:
#         raise ValueError("No readable text found in DOCX file.")
#     return _truncate(text)


# def _extract_xlsx_text(file_path: str) -> str:
#     try:
#         from openpyxl import load_workbook
#         workbook = load_workbook(file_path, read_only=True, data_only=True)
#         parts = []
#         for sheet in workbook.worksheets:
#             rows = [[cell for cell in row] for row in sheet.iter_rows(values_only=True)]
#             table_text = _format_table(f"SHEET: {sheet.title}", rows)
#             if table_text:
#                 parts.append(table_text)
#         workbook.close()
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)


# def _extract_xls_text(file_path: str) -> str:
#     try:
#         import pandas as pd
#         sheets = pd.read_excel(file_path, sheet_name=None, header=None, dtype=str, engine="xlrd")
#         parts = []
#         for sheet_name, frame in sheets.items():
#             frame = frame.dropna(how="all").dropna(axis=1, how="all")
#             rows = frame.where(pd.notna(frame), None).values.tolist()
#             table_text = _format_table(f"SHEET: {sheet_name}", rows)
#             if table_text:
#                 parts.append(table_text)
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)


# def _extract_csv_text(file_path: str) -> str:
#     last_error: Optional[Exception] = None
#     for encoding in ("utf-8-sig", "utf-8", "latin-1"):
#         try:
#             with open(file_path, newline="", encoding=encoding) as f:
#                 rows = list(csv.reader(f))
#             text = _format_table("CSV RUBRIC:", rows).strip()
#             if not text:
#                 raise ValueError("No readable text found in CSV rubric.")
#             return _truncate(text)
#         except Exception as exc:
#             last_error = exc
#     raise ValueError("Could not read CSV rubric content.") from last_error


# def extract_text(file_path: Optional[str], label: str, allowed_extensions: Set[str]) -> str:
#     if not file_path:
#         raise ValueError(f"{label} file path is missing.")
#     if not os.path.exists(file_path):
#         raise ValueError(f"{label} file was not found.")

#     ext = os.path.splitext(file_path)[1].lower()
#     if ext == ".doc":
#         raise ValueError(DOC_UNSUPPORTED_MESSAGE)

#     if ext not in allowed_extensions:
#         raise ValueError(UNSUPPORTED_FILE_MESSAGE)

#     if ext == ".pdf":
#         return _extract_pdf_text(file_path)

#     if ext == ".docx":
#         return _extract_docx_text(file_path)

#     if ext == ".xlsx":
#         return _extract_xlsx_text(file_path)

#     if ext == ".xls":
#         return _extract_xls_text(file_path)

#     if ext == ".csv":
#         return _extract_csv_text(file_path)

#     raise ValueError(UNSUPPORTED_FILE_MESSAGE)


# def extract_rubric_file_text(file_path: str) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "rubric", RUBRIC_EXTENSIONS)
#     return f"RUBRIC FILE: {filename}\n{content}"


# def extract_submission_file_text(file_path: str, index: int = 1) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "student submission", SUBMISSION_EXTENSIONS)
#     return f"FILE {index}: {filename}\n{content}"


# def submission_content(req: GradeRequest) -> str:
#     parts: List[str] = []
#     seen_paths: Set[str] = set()
#     files = req.submission.files or []

#     for index, file_info in enumerate(files, start=1):
#         if not file_info.file_path or file_info.file_path in seen_paths:
#             continue
#         seen_paths.add(file_info.file_path)
#         heading = extract_submission_file_text(file_info.file_path, index)
#         if file_info.required_document_name:
#             heading = f"REQUIRED DOCUMENT: {file_info.required_document_name}\n{heading}"
#         parts.append(heading)

#     if not parts and req.submission.file_path:
#         parts.append(extract_submission_file_text(req.submission.file_path))

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Student submission content is missing or unreadable.")
#     return _truncate(text)


# def rubric_content(req: GradeRequest) -> str:
#     parts = []
#     if req.rubric.rubric_text and req.rubric.rubric_text.strip():
#         parts.append(req.rubric.rubric_text.strip())
#     if req.rubric.file_path:
#         parts.append(extract_rubric_file_text(req.rubric.file_path))

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Rubric content is missing or unreadable.")
#     return _truncate(text)


# def _build_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None) -> str:
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was invalid for this reason:
# {correction}

# Return corrected JSON only.
# """

#     return f"""
# You are an academic assignment evaluation assistant for lecturers and heads of department.
# Evaluate the student submission using the uploaded assignment rubric internally.
# Do not copy the full rubric into the report.

# Assignment:
# - Name: {req.assignment.assignment_name}
# - Course: {req.assignment.course_name or "Not specified"}
# - Batch: {req.assignment.batch or "Not specified"}
# - Department: {req.assignment.department or "Not specified"}

# Student Number: {req.student.student_no}

# Rubric content:
# \"\"\"
# {rubric_text}
# \"\"\"

# Student submission content:
# \"\"\"
# {submission_text}
# \"\"\"

# Return ONLY one valid JSON object with this exact shape:
# {{
#   "score": 0,
#   "overall_evaluation": "Professional summary of submission quality.",
#   "strengths": ["Strength 1", "Strength 2"],
#   "areas_for_improvement": ["Issue 1", "Issue 2"],
#   "suggestions_for_improvement": ["Suggestion 1", "Suggestion 2"],
#   "overall_comment": "Final professional evaluation comment."
# }}

# Rules:
# - score must be a number from 0 to 100.
# - Base the evaluation on the rubric and submission.
# - Do not expose exact rubric marks, hidden grading logic, or raw rubric criteria.
# - Keep the report professional and useful for lecturer/head evaluation.
# - Do not include markdown fences.
# - Do not include text outside the JSON object.
# {correction_block}
# """


# def _build_feedback_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None) -> str:
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was unsafe or invalid for this reason:
# {correction}

# Return corrected JSON only.
# """

#     return f"""
# You are a helpful academic writing assistant giving private learning feedback to a student.
# Use the assignment details, uploaded rubric, and student submission internally only.
# Do not reveal the rubric, rubric criteria, hidden grading logic, marks, score, grade, awarded marks, or grading breakdown.

# Assignment:
# - Name: {req.assignment.assignment_name}
# - Course: {req.assignment.course_name or "Not specified"}
# - Batch: {req.assignment.batch or "Not specified"}
# - Department: {req.assignment.department or "Not specified"}

# Student submission content:
# \"\"\"
# {submission_text}
# \"\"\"

# Internal rubric content. Use it only to guide improvement advice. Do not mention or quote it:
# \"\"\"
# {rubric_text}
# \"\"\"

# Return ONLY one valid JSON object with this exact shape:
# {{
#   "overall_feedback": "Simple, helpful summary of the submission.",
#   "main_improvement_areas": ["Area 1", "Area 2"],
#   "practical_suggestions": ["Suggestion 1", "Suggestion 2"],
#   "final_advice": "Encouraging final advice for improving before official evaluation."
# }}

# Rules:
# - Do not mention score, grade, marks, points, percentages, rubric, criteria, awarded marks, or grading breakdown.
# - Give only improvement advice.
# - Write in simple, student-friendly language.
# - Do not include markdown fences.
# - Do not include text outside the JSON object.
# {correction_block}
# """


# def _extract_first_json(raw_output: str) -> Dict[str, Any]:
#     raw_output = (raw_output or "").strip()
#     if not raw_output:
#         raise ValueError("Model returned empty output.")

#     if "```" in raw_output:
#         parts = raw_output.split("```")
#         candidates = [p for p in parts if "{" in p]
#         if candidates:
#             raw_output = candidates[0].strip()
#             if raw_output.lower().startswith("json"):
#                 raw_output = raw_output[4:].strip()

#     try:
#         return json.loads(raw_output)
#     except json.JSONDecodeError:
#         pass

#     decoder = json.JSONDecoder()
#     for i, ch in enumerate(raw_output):
#         if ch == "{":
#             try:
#                 obj, _ = decoder.raw_decode(raw_output[i:])
#                 return obj
#             except json.JSONDecodeError:
#                 continue

#     raise ValueError("Model did not return a valid JSON object.")


# def _validate_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")

#     missing = [key for key in REQUIRED_KEYS if key not in obj]
#     if missing:
#         raise ValueError(f"Model output is missing keys: {', '.join(missing)}")

#     score = float(obj["score"])
#     if score < 0 or score > 100:
#         raise ValueError("Model score is outside the valid 0-100 range.")

#     for key in REQUIRED_KEYS[1:]:
#         value = obj.get(key)
#         if isinstance(value, list):
#             if not any(str(item).strip() for item in value):
#                 raise ValueError(f"Model output section is empty: {key}")
#         elif not str(value or "").strip():
#             raise ValueError(f"Model output section is empty: {key}")

#     obj["score"] = round(score, 2)
#     return obj


# def _feedback_text_has_unsafe_content(text: str) -> Optional[str]:
#     text = text or ""
#     for pattern in UNSAFE_FEEDBACK_PATTERNS:
#         if re.search(pattern, text, flags=re.IGNORECASE):
#             return pattern
#     return None


# def _sanitize_feedback_text_value(value: Any, fallback: str) -> str:
#     text = str(value or "").replace("\r", "\n").strip()
#     if not text:
#         return fallback

#     safe_segments: List[str] = []
#     for raw_line in text.splitlines():
#         line = raw_line.strip(" -\t")
#         if not line:
#             continue

#         # Keep safe sentences and drop any sentence that mentions restricted grading/rubric language.
#         for segment in re.split(r"(?<=[.!?])\s+", line):
#             segment = segment.strip(" -\t")
#             if segment and not _feedback_text_has_unsafe_content(segment):
#                 safe_segments.append(segment)

#     clean = " ".join(safe_segments).strip()
#     return clean or fallback


# def _sanitize_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     sanitized: Dict[str, Any] = {}
#     for key in FEEDBACK_REQUIRED_KEYS:
#         fallback = FEEDBACK_SAFE_FALLBACKS[key]
#         value = obj.get(key)

#         if isinstance(value, list):
#             items = [
#                 _sanitize_feedback_text_value(item, "")
#                 for item in value
#             ]
#             sanitized[key] = [item for item in items if item] or [fallback]
#         else:
#             sanitized[key] = _sanitize_feedback_text_value(value, fallback)

#     return sanitized


# def _validate_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")

#     if not any(str(obj.get(key) or "").strip() for key in FEEDBACK_REQUIRED_KEYS):
#         raise ValueError("Model output did not include usable feedback sections.")

#     sanitized = _sanitize_feedback_structured(obj)
#     rendered = _render_feedback(sanitized)
#     unsafe = _feedback_text_has_unsafe_content(rendered)
#     if unsafe:
#         raise ValueError("Sanitized feedback still contained restricted grading or rubric language.")

#     return sanitized


# def _call_ollama(prompt: str) -> Dict[str, Any]:
#     client = ollama.Client(host=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT_SECONDS)
#     response = client.chat(
#         model=OLLAMA_MODEL,
#         messages=[{"role": "user", "content": prompt}],
#         stream=False,
#     )
#     raw_output = response["message"]["content"]
#     return _extract_first_json(raw_output)


# def _as_bullets(value: Any) -> str:
#     if isinstance(value, list):
#         items = [str(item).strip() for item in value if str(item).strip()]
#     else:
#         items = [line.strip("- ").strip() for line in str(value).splitlines() if line.strip()]

#     if not items:
#         return "-"
#     return "\n".join(f"- {item}" for item in items)


# def _render_report(req: GradeRequest, structured: Dict[str, Any]) -> str:
#     generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
#     return f"""AI Assignment Evaluation Report

# Student Number: {req.student.student_no}
# Assignment: {req.assignment.assignment_name}
# Course: {req.assignment.course_name or "Not specified"}
# Generated Date: {generated_at}

# 1. Overall Evaluation
# {structured["overall_evaluation"]}

# 2. Strengths of the Submission
# {_as_bullets(structured["strengths"])}

# 3. Areas That Need Improvement
# {_as_bullets(structured["areas_for_improvement"])}

# 4. Suggestions for Improvement
# {_as_bullets(structured["suggestions_for_improvement"])}

# 5. Overall Comment
# {structured["overall_comment"]}
# """


# def _render_feedback(structured: Dict[str, Any]) -> str:
#     return f"""AI Learning Feedback Report

# 1. Overall Feedback
# {structured["overall_feedback"]}

# 2. Main Improvement Areas
# {_as_bullets(structured["main_improvement_areas"])}

# 3. Practical Suggestions
# {_as_bullets(structured["practical_suggestions"])}

# 4. Final Advice
# {structured["final_advice"]}
# """


# def _validate_report_text(report: str) -> None:
#     if not report.strip():
#         raise ValueError("Generated report is empty.")
#     required_sections = [
#         "AI Assignment Evaluation Report",
#         "1. Overall Evaluation",
#         "2. Strengths of the Submission",
#         "3. Areas That Need Improvement",
#         "4. Suggestions for Improvement",
#         "5. Overall Comment",
#     ]
#     missing = [section for section in required_sections if section not in report]
#     if missing:
#         raise ValueError(f"Generated report is missing sections: {', '.join(missing)}")


# def _validate_feedback_text(feedback: str) -> None:
#     if not feedback.strip():
#         raise ValueError("Generated feedback is empty.")
#     required_sections = [
#         "AI Learning Feedback Report",
#         "1. Overall Feedback",
#         "2. Main Improvement Areas",
#         "3. Practical Suggestions",
#         "4. Final Advice",
#     ]
#     missing = [section for section in required_sections if section not in feedback]
#     if missing:
#         raise ValueError(f"Generated feedback is missing sections: {', '.join(missing)}")
#     if _feedback_text_has_unsafe_content(feedback):
#         raise ValueError("Generated feedback contained restricted grading or rubric language.")


# @app.get("/health")
# def health():
#     return {
#         "ok": True,
#         "ollama_base_url": OLLAMA_BASE_URL,
#         "ollama_model": OLLAMA_MODEL,
#     }


# @app.post("/grade", response_model=GradeResponse)
# def grade(req: GradeRequest):
#     try:
#         rubric_text = rubric_content(req)
#         submission_text = submission_content(req)

#         first_error = None
#         structured = None

#         for attempt in range(2):
#             try:
#                 prompt = _build_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt == 1 and first_error else None,
#                 )
#                 structured = _validate_structured(_call_ollama(prompt))
#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 1:
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid grading output.")

#         report = _render_report(req, structured)
#         _validate_report_text(report)

#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="graded",
#             ai_grade=structured["score"],
#             ai_report_text=report,
#             ai_model=OLLAMA_MODEL,
#         )
#     except Exception as exc:
#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             ai_grade=None,
#             ai_report_text=None,
#             ai_model=OLLAMA_MODEL,
#             error=str(exc),
#         )


# @app.post("/feedback", response_model=FeedbackResponse)
# def feedback(req: GradeRequest):
#     try:
#         rubric_text = rubric_content(req)
#         submission_text = submission_content(req)

#         first_error = None
#         structured = None

#         for attempt in range(2):
#             try:
#                 prompt = _build_feedback_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt == 1 and first_error else None,
#                 )
#                 structured = _validate_feedback_structured(_call_ollama(prompt))
#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 1:
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid feedback output.")

#         feedback_text = _render_feedback(structured)
#         _validate_feedback_text(feedback_text)

#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="completed",
#             feedback_text=feedback_text,
#             ai_model=OLLAMA_MODEL,
#         )
#     except Exception as exc:
#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             feedback_text=None,
#             ai_model=OLLAMA_MODEL,
#             error=str(exc),
#         )




# #updated code with new build promt and report structure.
# import json
# import os
# import re
# import csv
# from datetime import datetime
# from pathlib import Path
# from typing import Any, Dict, List, Optional, Set

# from dotenv import load_dotenv
# from fastapi import FastAPI
# from pydantic import BaseModel

# import ollama

# load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

# app = FastAPI(title="AIAGS ML Service", version="2.0")


# def _env_int(name: str, default: int) -> int:
#     raw_value = os.getenv(name, str(default))
#     clean_value = raw_value.split("#", 1)[0].strip()
#     try:
#         return int(clean_value)
#     except ValueError as exc:
#         raise ValueError(f"{name} must be an integer value, got {raw_value!r}") from exc


# OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
# OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", os.getenv("AIAGS_OLLAMA_MODEL", "llama3.1:8b"))

# print(f"Using Ollama model: {OLLAMA_MODEL}")

# OLLAMA_TIMEOUT_SECONDS = _env_int("OLLAMA_TIMEOUT_SECONDS", 120)
# MAX_EXTRACTED_CHARS = _env_int("MAX_EXTRACTED_CHARS", 30000)

# RUBRIC_EXTENSIONS = {".xlsx", ".xls", ".csv", ".pdf", ".docx"}
# SUBMISSION_EXTENSIONS = {".pdf", ".docx"}
# UNSUPPORTED_FILE_MESSAGE = (
#     "Unsupported file type. Please upload rubric as Excel/PDF/DOCX and assignment submission as PDF or DOCX."
# )
# DOC_UNSUPPORTED_MESSAGE = "DOC files are not supported. Please convert the document to DOCX or PDF and upload again."
# PDF_TEXT_UNREADABLE_MESSAGE = (
#     "PDF text could not be extracted. The file may be scanned or image-based. "
#     "Please upload a text-based PDF or DOCX."
# )


# class AssignmentInfo(BaseModel):
#     assignment_id: int
#     assignment_name: str
#     course_name: Optional[str] = None
#     batch: Optional[str] = None
#     department: Optional[str] = None
#     start_date: Optional[str] = None
#     deadline_date: Optional[str] = None
#     remark: Optional[str] = None


# class StudentInfo(BaseModel):
#     student_no: str


# class RubricInfo(BaseModel):
#     rubric_id: int
#     rubric_name: Optional[str] = None
#     rubric_text: Optional[str] = None
#     file_path: Optional[str] = None
#     file_mime: Optional[str] = None
#     file_original_name: Optional[str] = None


# class SubmissionFileInfo(BaseModel):
#     file_id: Optional[int] = None
#     file_path: str
#     file_original_name: Optional[str] = None
#     file_mime: Optional[str] = None
#     required_document_name: Optional[str] = None


# class SubmissionInfo(BaseModel):
#     portfolio_id: int
#     file_path: str
#     portfolio_link: Optional[str] = None
#     uploaded_at: Optional[str] = None
#     files: Optional[List[SubmissionFileInfo]] = None


# class GradeRequest(BaseModel):
#     portfolio_id: int
#     assignment: AssignmentInfo
#     student: StudentInfo
#     rubric: RubricInfo
#     submission: SubmissionInfo


# class GradeResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     ai_grade: Optional[float] = None
#     ai_report_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None


# class FeedbackResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     feedback_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None


# # UPDATED: Required JSON keys for the new grading output
# REQUIRED_KEYS = [
#     "total_score",
#     "rubric_criteria_feedback",
#     "overall_strengths",
#     "overall_weaknesses",
#     "checklist",
# ]

# FEEDBACK_REQUIRED_KEYS = [
#     "overall_feedback",
#     "main_improvement_areas",
#     "practical_suggestions",
#     "final_advice",
# ]

# UNSAFE_FEEDBACK_PATTERNS = [
#     r"\bscore\b",
#     r"\bgrade\b",
#     r"\bmarks?\b",
#     r"\bpoints?\b",
#     r"\brubric\b",
#     r"\bcriteria?\b",
#     r"\bcriterion\b",
#     r"\bawarded\b",
#     r"\bgrading\b",
#     r"\b\d{1,3}\s*(/|out of)\s*100\b",
#     r"\b\d{1,3}\s*%\b",
# ]

# FEEDBACK_SAFE_FALLBACKS = {
#     "overall_feedback": "Your submission has been reviewed for learning support. Focus on making your explanation clearer, more complete, and easier to follow.",
#     "main_improvement_areas": "Improve clarity, organization, evidence, and completeness in the main sections of your work.",
#     "practical_suggestions": "Review each section, add clearer explanations, support important statements, and check formatting before submitting again.",
#     "final_advice": "Revise your work carefully and use this feedback to strengthen your submission before official evaluation.",
# }


# def _truncate(text: str) -> str:
#     text = (text or "").strip()
#     if len(text) <= MAX_EXTRACTED_CHARS:
#         return text
#     return text[:MAX_EXTRACTED_CHARS] + "\n\n[Content truncated for AI processing.]"


# def _format_table(title: str, rows: List[List[Any]]) -> str:
#     cleaned_rows: List[List[str]] = []
#     for row in rows:
#         cleaned = [str(cell).strip() if cell is not None else "" for cell in row]
#         if any(cleaned):
#             cleaned_rows.append(cleaned)

#     if not cleaned_rows:
#         return ""

#     max_cols = max(len(row) for row in cleaned_rows)
#     lines = [title]
#     for idx, row in enumerate(cleaned_rows, start=1):
#         normalized = row + [""] * (max_cols - len(row))
#         lines.append(f"Row {idx}: " + " | ".join(normalized))
#     return "\n".join(lines)


# def _extract_pdf_text(file_path: str) -> str:
#     text_parts: List[str] = []
#     try:
#         import pdfplumber
#         with pdfplumber.open(file_path) as pdf:
#             for page in pdf.pages:
#                 page_text = page.extract_text() or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#     except Exception:
#         text_parts = []

#     if not text_parts:
#         try:
#             import fitz
#             doc = fitz.open(file_path)
#             for page in doc:
#                 page_text = page.get_text("text") or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#         except Exception:
#             text_parts = []

#     text = "\n".join(text_parts).strip()
#     if not text:
#         raise ValueError(PDF_TEXT_UNREADABLE_MESSAGE)
#     return _truncate(text)


# def _extract_docx_text(file_path: str) -> str:
#     try:
#         from docx import Document
#         doc = Document(file_path)
#         text_parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
#         for table_index, table in enumerate(doc.tables, start=1):
#             rows = []
#             for row in table.rows:
#                 rows.append([cell.text.replace("\n", " ").strip() for cell in row.cells])
#             table_text = _format_table(f"TABLE {table_index}:", rows)
#             if table_text:
#                 text_parts.append(table_text)
#         text = "\n".join(text_parts).strip()
#     except Exception as exc:
#         raise ValueError("Could not read DOCX content.") from exc

#     if not text:
#         raise ValueError("No readable text found in DOCX file.")
#     return _truncate(text)


# def _extract_xlsx_text(file_path: str) -> str:
#     try:
#         from openpyxl import load_workbook
#         workbook = load_workbook(file_path, read_only=True, data_only=True)
#         parts = []
#         for sheet in workbook.worksheets:
#             rows = [[cell for cell in row] for row in sheet.iter_rows(values_only=True)]
#             table_text = _format_table(f"SHEET: {sheet.title}", rows)
#             if table_text:
#                 parts.append(table_text)
#         workbook.close()
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)


# def _extract_xls_text(file_path: str) -> str:
#     try:
#         import pandas as pd
#         sheets = pd.read_excel(file_path, sheet_name=None, header=None, dtype=str, engine="xlrd")
#         parts = []
#         for sheet_name, frame in sheets.items():
#             frame = frame.dropna(how="all").dropna(axis=1, how="all")
#             rows = frame.where(pd.notna(frame), None).values.tolist()
#             table_text = _format_table(f"SHEET: {sheet_name}", rows)
#             if table_text:
#                 parts.append(table_text)
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)


# def _extract_csv_text(file_path: str) -> str:
#     last_error: Optional[Exception] = None
#     for encoding in ("utf-8-sig", "utf-8", "latin-1"):
#         try:
#             with open(file_path, newline="", encoding=encoding) as f:
#                 rows = list(csv.reader(f))
#             text = _format_table("CSV RUBRIC:", rows).strip()
#             if not text:
#                 raise ValueError("No readable text found in CSV rubric.")
#             return _truncate(text)
#         except Exception as exc:
#             last_error = exc
#     raise ValueError("Could not read CSV rubric content.") from last_error


# def extract_text(file_path: Optional[str], label: str, allowed_extensions: Set[str]) -> str:
#     if not file_path:
#         raise ValueError(f"{label} file path is missing.")
#     if not os.path.exists(file_path):
#         raise ValueError(f"{label} file was not found.")

#     ext = os.path.splitext(file_path)[1].lower()
#     if ext == ".doc":
#         raise ValueError(DOC_UNSUPPORTED_MESSAGE)

#     if ext not in allowed_extensions:
#         raise ValueError(UNSUPPORTED_FILE_MESSAGE)

#     if ext == ".pdf":
#         return _extract_pdf_text(file_path)

#     if ext == ".docx":
#         return _extract_docx_text(file_path)

#     if ext == ".xlsx":
#         return _extract_xlsx_text(file_path)

#     if ext == ".xls":
#         return _extract_xls_text(file_path)

#     if ext == ".csv":
#         return _extract_csv_text(file_path)

#     raise ValueError(UNSUPPORTED_FILE_MESSAGE)


# def extract_rubric_file_text(file_path: str) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "rubric", RUBRIC_EXTENSIONS)
#     return f"RUBRIC FILE: {filename}\n{content}"


# def extract_submission_file_text(file_path: str, index: int = 1) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "student submission", SUBMISSION_EXTENSIONS)
#     return f"FILE {index}: {filename}\n{content}"


# def submission_content(req: GradeRequest) -> str:
#     parts: List[str] = []
#     seen_paths: Set[str] = set()
#     files = req.submission.files or []

#     for index, file_info in enumerate(files, start=1):
#         if not file_info.file_path or file_info.file_path in seen_paths:
#             continue
#         seen_paths.add(file_info.file_path)
#         heading = extract_submission_file_text(file_info.file_path, index)
#         if file_info.required_document_name:
#             heading = f"REQUIRED DOCUMENT: {file_info.required_document_name}\n{heading}"
#         parts.append(heading)

#     if not parts and req.submission.file_path:
#         parts.append(extract_submission_file_text(req.submission.file_path))

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Student submission content is missing or unreadable.")
#     return _truncate(text)


# def rubric_content(req: GradeRequest) -> str:
#     parts = []
#     if req.rubric.rubric_text and req.rubric.rubric_text.strip():
#         parts.append(req.rubric.rubric_text.strip())
#     if req.rubric.file_path:
#         parts.append(extract_rubric_file_text(req.rubric.file_path))

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Rubric content is missing or unreadable.")
#     return _truncate(text)


# # UPDATED: New prompt for medical portfolio grading
# def _build_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None) -> str:
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was invalid for this reason:
# {correction}

# Return corrected JSON only.
# """

#     return f"""
# You are a medical education assessor with postgraduate qualifications.
# Grade the student portfolio (multiple entries) using the provided rubric.

# RULES:
# 1. Read all entries in the submission before scoring.
# 2. Strictly adhere to the rubric provided below, including the marking criteria and weightage table.
# 3. Score each criterion on a scale of 1-4 (4=Excellent, 3=Good, 2=Satisfactory, 1=Needs Improvement).
# 4. Weighted Score = (score) * (weightage). Sum all weighted scores to get the total score out of 100.
# 5. Score only what is textually present in the submission. Do not infer missing details.
# 6. Do not penalise for formatting errors unless they severely obstruct understanding.
# 7. Use the entry requirements (if present in the rubric) to judge Comprehensiveness and to generate the checklist.

# OUTPUT: Return ONLY one valid JSON object with exactly this structure:
# {{
#   "total_score": 0,
#   "rubric_criteria_feedback": [
#     {{"criterion": "Depth of reflection", "feedback": "Your constructive feedback here."}},
#     {{"criterion": "Critical thinking and evaluative abilities", "feedback": "..."}},
#     {{"criterion": "Creativity and Innovation", "feedback": "..."}},
#     {{"criterion": "Content and Comprehensiveness", "feedback": "..."}},
#     {{"criterion": "Structure, Presentation and Organization", "feedback": "..."}}
#   ],
#   "overall_strengths": "Summary of overall strengths across all entries.",
#   "overall_weaknesses": "Summary of overall weaknesses across all entries.",
#   "checklist": [
#     {{"item": "Checklist item 1 (from entry requirements)", "status": "Present"}},
#     {{"item": "Checklist item 2", "status": "Not Present"}},
#     {{"item": "Checklist item 3", "status": "Present"}},
#     {{"item": "Checklist item 4", "status": "Present"}},
#     {{"item": "Checklist item 5", "status": "Not Present"}}
#   ]
# }}

# Rules for the JSON:
# - total_score must be a number between 0 and 100.
# - The "rubric_criteria_feedback" array must contain exactly the five criteria shown, using the exact criterion names from the rubric if they differ.
# - For each criterion, provide a constructive feedback paragraph summarising performance across all entries.
# - "overall_strengths" and "overall_weaknesses" must be non-empty strings.
# - "checklist" must contain exactly 5 items derived from the entry requirements in the rubric. For each, state "Present" or "Not Present".
# - Do not include markdown fences or text outside the JSON object.
# {correction_block}

# Rubric content (includes marking criteria, weightage, and entry requirements):
# \"\"\"
# {rubric_text}
# \"\"\"

# Student portfolio submission (all entries):
# \"\"\"
# {submission_text}
# \"\"\"
# """


# def _build_feedback_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None) -> str:
#     # This endpoint is unchanged from the original, as per the new requirement.
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was unsafe or invalid for this reason:
# {correction}

# Return corrected JSON only.
# """

#     return f"""
# You are a helpful academic writing assistant giving private learning feedback to a student.
# Use the assignment details, uploaded rubric, and student submission internally only.
# Do not reveal the rubric, rubric criteria, hidden grading logic, marks, score, grade, awarded marks, or grading breakdown.

# Assignment:
# - Name: {req.assignment.assignment_name}
# - Course: {req.assignment.course_name or "Not specified"}
# - Batch: {req.assignment.batch or "Not specified"}
# - Department: {req.assignment.department or "Not specified"}

# Student submission content:
# \"\"\"
# {submission_text}
# \"\"\"

# Internal rubric content. Use it only to guide improvement advice. Do not mention or quote it:
# \"\"\"
# {rubric_text}
# \"\"\"

# Return ONLY one valid JSON object with this exact shape:
# {{
#   "overall_feedback": "Simple, helpful summary of the submission.",
#   "main_improvement_areas": ["Area 1", "Area 2"],
#   "practical_suggestions": ["Suggestion 1", "Suggestion 2"],
#   "final_advice": "Encouraging final advice for improving before official evaluation."
# }}

# Rules:
# - Do not mention score, grade, marks, points, percentages, rubric, criteria, awarded marks, or grading breakdown.
# - Give only improvement advice.
# - Write in simple, student-friendly language.
# - Do not include markdown fences.
# - Do not include text outside the JSON object.
# {correction_block}
# """


# def _extract_first_json(raw_output: str) -> Dict[str, Any]:
#     raw_output = (raw_output or "").strip()
#     if not raw_output:
#         raise ValueError("Model returned empty output.")

#     if "```" in raw_output:
#         parts = raw_output.split("```")
#         candidates = [p for p in parts if "{" in p]
#         if candidates:
#             raw_output = candidates[0].strip()
#             if raw_output.lower().startswith("json"):
#                 raw_output = raw_output[4:].strip()

#     try:
#         return json.loads(raw_output)
#     except json.JSONDecodeError:
#         pass

#     decoder = json.JSONDecoder()
#     for i, ch in enumerate(raw_output):
#         if ch == "{":
#             try:
#                 obj, _ = decoder.raw_decode(raw_output[i:])
#                 return obj
#             except json.JSONDecodeError:
#                 continue

#     raise ValueError("Model did not return a valid JSON object.")


# # UPDATED: Validation for the new grading JSON
# def _validate_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")

#     missing = [key for key in REQUIRED_KEYS if key not in obj]
#     if missing:
#         raise ValueError(f"Model output is missing keys: {', '.join(missing)}")

#     # Validate total_score
#     score = float(obj["total_score"])
#     if score < 0 or score > 100:
#         raise ValueError("Total score is outside the valid 0-100 range.")
#     obj["total_score"] = round(score, 2)

#     # Validate rubric_criteria_feedback
#     feedback_list = obj.get("rubric_criteria_feedback", [])
#     if not isinstance(feedback_list, list) or len(feedback_list) != 5:
#         raise ValueError("rubric_criteria_feedback must be a list of exactly 5 items.")
#     for item in feedback_list:
#         if not isinstance(item, dict) or "criterion" not in item or "feedback" not in item:
#             raise ValueError("Each item in rubric_criteria_feedback must have 'criterion' and 'feedback' keys.")
#         if not str(item["criterion"]).strip() or not str(item["feedback"]).strip():
#             raise ValueError("Criterion name and feedback must not be empty.")

#     # Validate overall strings
#     for key in ("overall_strengths", "overall_weaknesses"):
#         if not str(obj.get(key, "")).strip():
#             raise ValueError(f"Model output section '{key}' is empty.")

#     # Validate checklist
#     checklist = obj.get("checklist", [])
#     if not isinstance(checklist, list) or len(checklist) != 5:
#         raise ValueError("checklist must be a list of exactly 5 items.")
#     for item in checklist:
#         if not isinstance(item, dict) or "item" not in item or "status" not in item:
#             raise ValueError("Each checklist item must have 'item' and 'status' keys.")
#         status = str(item["status"]).strip().lower()
#         if status not in ("present", "not present"):
#             raise ValueError("Checklist status must be 'Present' or 'Not Present'.")

#     return obj


# # Feedback validation (unchanged)
# def _feedback_text_has_unsafe_content(text: str) -> Optional[str]:
#     text = text or ""
#     for pattern in UNSAFE_FEEDBACK_PATTERNS:
#         if re.search(pattern, text, flags=re.IGNORECASE):
#             return pattern
#     return None


# def _sanitize_feedback_text_value(value: Any, fallback: str) -> str:
#     text = str(value or "").replace("\r", "\n").strip()
#     if not text:
#         return fallback

#     safe_segments: List[str] = []
#     for raw_line in text.splitlines():
#         line = raw_line.strip(" -\t")
#         if not line:
#             continue

#         for segment in re.split(r"(?<=[.!?])\s+", line):
#             segment = segment.strip(" -\t")
#             if segment and not _feedback_text_has_unsafe_content(segment):
#                 safe_segments.append(segment)

#     clean = " ".join(safe_segments).strip()
#     return clean or fallback


# def _sanitize_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     sanitized: Dict[str, Any] = {}
#     for key in FEEDBACK_REQUIRED_KEYS:
#         fallback = FEEDBACK_SAFE_FALLBACKS[key]
#         value = obj.get(key)

#         if isinstance(value, list):
#             items = [
#                 _sanitize_feedback_text_value(item, "")
#                 for item in value
#             ]
#             sanitized[key] = [item for item in items if item] or [fallback]
#         else:
#             sanitized[key] = _sanitize_feedback_text_value(value, fallback)

#     return sanitized


# def _validate_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")

#     if not any(str(obj.get(key) or "").strip() for key in FEEDBACK_REQUIRED_KEYS):
#         raise ValueError("Model output did not include usable feedback sections.")

#     sanitized = _sanitize_feedback_structured(obj)
#     rendered = _render_feedback(sanitized)
#     unsafe = _feedback_text_has_unsafe_content(rendered)
#     if unsafe:
#         raise ValueError("Sanitized feedback still contained restricted grading or rubric language.")

#     return sanitized


# def _call_ollama(prompt: str) -> Dict[str, Any]:
#     client = ollama.Client(host=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT_SECONDS)
#     response = client.chat(
#         model=OLLAMA_MODEL,
#         messages=[{"role": "user", "content": prompt}],
#         stream=False,
#     )
#     raw_output = response["message"]["content"]
#     return _extract_first_json(raw_output)


# def _as_bullets(value: Any) -> str:
#     if isinstance(value, list):
#         items = [str(item).strip() for item in value if str(item).strip()]
#     else:
#         items = [line.strip("- ").strip() for line in str(value).splitlines() if line.strip()]

#     if not items:
#         return "-"
#     return "\n".join(f"- {item}" for item in items)


# # UPDATED: New report renderer
# def _render_report(req: GradeRequest, structured: Dict[str, Any]) -> str:
#     generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
#     score_line = f"Score out of 100: {structured['total_score']}"

#     # Build rubric criteria feedback section
#     criteria_lines = ["1. The rubric criteria"]
#     for idx, crit in enumerate(structured["rubric_criteria_feedback"], start=1):
#         criteria_lines.append(f"{idx}) {crit['criterion']}: {crit['feedback']}")

#     # Overall strengths/weaknesses
#     strengths = f"1) Overall strengths: {structured['overall_strengths']}"
#     weaknesses = f"2) Overall weaknesses: {structured['overall_weaknesses']}"

#     # Checklist
#     checklist_lines = ["3. Presence of absence of checklist items."]
#     for idx, item in enumerate(structured["checklist"], start=1):
#         checklist_lines.append(f"{idx}) {item['item']}: {item['status']}")

#     report = f"""AI Assignment Evaluation Report

# Student Number: {req.student.student_no}
# Assignment: {req.assignment.assignment_name}
# Course: {req.assignment.course_name or "Not specified"}
# Generated Date: {generated_at}

# {score_line}

# Feedback criteria for all entries of the portfolio
# {chr(10).join(criteria_lines)}

# 2. Overall strength and weaknesses
# {strengths}
# {weaknesses}

# {chr(10).join(checklist_lines)}
# """
#     return report


# def _render_feedback(structured: Dict[str, Any]) -> str:
#     # Unchanged
#     return f"""AI Learning Feedback Report

# 1. Overall Feedback
# {structured["overall_feedback"]}

# 2. Main Improvement Areas
# {_as_bullets(structured["main_improvement_areas"])}

# 3. Practical Suggestions
# {_as_bullets(structured["practical_suggestions"])}

# 4. Final Advice
# {structured["final_advice"]}
# """


# # UPDATED: Validate report text for required sections
# def _validate_report_text(report: str) -> None:
#     if not report.strip():
#         raise ValueError("Generated report is empty.")
#     required_sections = [
#         "AI Assignment Evaluation Report",
#         "Score out of 100:",
#         "Feedback criteria for all entries of the portfolio",
#         "1. The rubric criteria",
#         "2. Overall strength and weaknesses",
#         "3. Presence of absence of checklist items.",
#     ]
#     missing = [section for section in required_sections if section not in report]
#     if missing:
#         raise ValueError(f"Generated report is missing sections: {', '.join(missing)}")


# def _validate_feedback_text(feedback: str) -> None:
#     if not feedback.strip():
#         raise ValueError("Generated feedback is empty.")
#     required_sections = [
#         "AI Learning Feedback Report",
#         "1. Overall Feedback",
#         "2. Main Improvement Areas",
#         "3. Practical Suggestions",
#         "4. Final Advice",
#     ]
#     missing = [section for section in required_sections if section not in feedback]
#     if missing:
#         raise ValueError(f"Generated feedback is missing sections: {', '.join(missing)}")
#     if _feedback_text_has_unsafe_content(feedback):
#         raise ValueError("Generated feedback contained restricted grading or rubric language.")


# @app.get("/health")
# def health():
#     return {
#         "ok": True,
#         "ollama_base_url": OLLAMA_BASE_URL,
#         "ollama_model": OLLAMA_MODEL,
#     }


# @app.post("/grade", response_model=GradeResponse)
# def grade(req: GradeRequest):
#     try:
#         rubric_text = rubric_content(req)
#         submission_text = submission_content(req)

#         first_error = None
#         structured = None

#         for attempt in range(2):
#             try:
#                 prompt = _build_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt == 1 and first_error else None,
#                 )
#                 structured = _validate_structured(_call_ollama(prompt))
#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 1:
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid grading output.")

#         report = _render_report(req, structured)
#         _validate_report_text(report)

#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="graded",
#             ai_grade=structured["total_score"],  # now total_score
#             ai_report_text=report,
#             ai_model=OLLAMA_MODEL,
#         )
#     except Exception as exc:
#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             ai_grade=None,
#             ai_report_text=None,
#             ai_model=OLLAMA_MODEL,
#             error=str(exc),
#         )


# @app.post("/feedback", response_model=FeedbackResponse)
# def feedback(req: GradeRequest):
#     try:
#         rubric_text = rubric_content(req)
#         submission_text = submission_content(req)

#         first_error = None
#         structured = None

#         for attempt in range(2):
#             try:
#                 prompt = _build_feedback_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt == 1 and first_error else None,
#                 )
#                 structured = _validate_feedback_structured(_call_ollama(prompt))
#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 1:
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid feedback output.")

#         feedback_text = _render_feedback(structured)
#         _validate_feedback_text(feedback_text)

#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="completed",
#             feedback_text=feedback_text,
#             ai_model=OLLAMA_MODEL,
#         )
#     except Exception as exc:
#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             feedback_text=None,
#             ai_model=OLLAMA_MODEL,
#             error=str(exc),
#         )



# #updated 2  code with new build promt and report structure.(because above promt giev model did not give json output error.)
# import json
# import os
# import re
# import csv
# import sys
# from datetime import datetime
# from pathlib import Path
# from typing import Any, Dict, List, Optional, Set

# from dotenv import load_dotenv
# from fastapi import FastAPI
# from pydantic import BaseModel

# import ollama

# load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

# app = FastAPI(title="AIAGS ML Service", version="2.0")


# def _env_int(name: str, default: int) -> int:
#     raw_value = os.getenv(name, str(default))
#     clean_value = raw_value.split("#", 1)[0].strip()
#     try:
#         return int(clean_value)
#     except ValueError as exc:
#         raise ValueError(f"{name} must be an integer value, got {raw_value!r}") from exc


# def _env_float(name: str, default: float) -> float:
#     raw_value = os.getenv(name, str(default))
#     clean_value = raw_value.split("#", 1)[0].strip()
#     try:
#         return float(clean_value)
#     except ValueError as exc:
#         raise ValueError(f"{name} must be a float value, got {raw_value!r}") from exc


# def _env_bool(name: str, default: bool) -> bool:
#     raw_value = os.getenv(name, str(default)).strip().lower()
#     return raw_value in ("1", "true", "yes", "on")


# OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
# OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", os.getenv("AIAGS_OLLAMA_MODEL", "llama3.1:8b"))

# print(f"Using Ollama model: {OLLAMA_MODEL}")

# OLLAMA_TIMEOUT_SECONDS = _env_int("OLLAMA_TIMEOUT_SECONDS", 120)
# MAX_EXTRACTED_CHARS = _env_int("MAX_EXTRACTED_CHARS", 30000)
# MAX_INPUT_CHARS_FOR_SMALL_MODEL = _env_int("MAX_INPUT_CHARS_FOR_SMALL_MODEL", 4000)   # UPDATED: shrink input for 4B models

# OLLAMA_JSON_MODE = _env_bool("OLLAMA_JSON_MODE", True)
# OLLAMA_TEMPERATURE = _env_float("OLLAMA_TEMPERATURE", 0.0)
# OLLAMA_NUM_PREDICT = _env_int("OLLAMA_NUM_PREDICT", 4096)
# DEBUG_RAW_OUTPUT = _env_bool("DEBUG_RAW_OUTPUT", True)

# RUBRIC_EXTENSIONS = {".xlsx", ".xls", ".csv", ".pdf", ".docx"}
# SUBMISSION_EXTENSIONS = {".pdf", ".docx"}
# UNSUPPORTED_FILE_MESSAGE = (
#     "Unsupported file type. Please upload rubric as Excel/PDF/DOCX and assignment submission as PDF or DOCX."
# )
# DOC_UNSUPPORTED_MESSAGE = "DOC files are not supported. Please convert the document to DOCX or PDF and upload again."
# PDF_TEXT_UNREADABLE_MESSAGE = (
#     "PDF text could not be extracted. The file may be scanned or image-based. "
#     "Please upload a text-based PDF or DOCX."
# )


# class AssignmentInfo(BaseModel):
#     assignment_id: int
#     assignment_name: str
#     course_name: Optional[str] = None
#     batch: Optional[str] = None
#     department: Optional[str] = None
#     start_date: Optional[str] = None
#     deadline_date: Optional[str] = None
#     remark: Optional[str] = None


# class StudentInfo(BaseModel):
#     student_no: str


# class RubricInfo(BaseModel):
#     rubric_id: int
#     rubric_name: Optional[str] = None
#     rubric_text: Optional[str] = None
#     file_path: Optional[str] = None
#     file_mime: Optional[str] = None
#     file_original_name: Optional[str] = None


# class SubmissionFileInfo(BaseModel):
#     file_id: Optional[int] = None
#     file_path: str
#     file_original_name: Optional[str] = None
#     file_mime: Optional[str] = None
#     required_document_name: Optional[str] = None


# class SubmissionInfo(BaseModel):
#     portfolio_id: int
#     file_path: str
#     portfolio_link: Optional[str] = None
#     uploaded_at: Optional[str] = None
#     files: Optional[List[SubmissionFileInfo]] = None


# class GradeRequest(BaseModel):
#     portfolio_id: int
#     assignment: AssignmentInfo
#     student: StudentInfo
#     rubric: RubricInfo
#     submission: SubmissionInfo


# class GradeResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     ai_grade: Optional[float] = None
#     ai_report_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None


# class FeedbackResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     feedback_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None


# REQUIRED_KEYS = [
#     "total_score",
#     "rubric_criteria_feedback",
#     "overall_strengths",
#     "overall_weaknesses",
#     "checklist",
# ]

# FEEDBACK_REQUIRED_KEYS = [
#     "overall_feedback",
#     "main_improvement_areas",
#     "practical_suggestions",
#     "final_advice",
# ]

# UNSAFE_FEEDBACK_PATTERNS = [
#     r"\bscore\b",
#     r"\bgrade\b",
#     r"\bmarks?\b",
#     r"\bpoints?\b",
#     r"\brubric\b",
#     r"\bcriteria?\b",
#     r"\bcriterion\b",
#     r"\bawarded\b",
#     r"\bgrading\b",
#     r"\b\d{1,3}\s*(/|out of)\s*100\b",
#     r"\b\d{1,3}\s*%\b",
# ]

# FEEDBACK_SAFE_FALLBACKS = {
#     "overall_feedback": "Your submission has been reviewed for learning support. Focus on making your explanation clearer, more complete, and easier to follow.",
#     "main_improvement_areas": "Improve clarity, organization, evidence, and completeness in the main sections of your work.",
#     "practical_suggestions": "Review each section, add clearer explanations, support important statements, and check formatting before submitting again.",
#     "final_advice": "Revise your work carefully and use this feedback to strengthen your submission before official evaluation.",
# }


# def _truncate(text: str, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     text = (text or "").strip()
#     if len(text) <= max_chars:
#         return text
#     return text[:max_chars] + "\n\n[Content truncated for AI processing.]"


# def _format_table(title: str, rows: List[List[Any]]) -> str:
#     cleaned_rows: List[List[str]] = []
#     for row in rows:
#         cleaned = [str(cell).strip() if cell is not None else "" for cell in row]
#         if any(cleaned):
#             cleaned_rows.append(cleaned)

#     if not cleaned_rows:
#         return ""

#     max_cols = max(len(row) for row in cleaned_rows)
#     lines = [title]
#     for idx, row in enumerate(cleaned_rows, start=1):
#         normalized = row + [""] * (max_cols - len(row))
#         lines.append(f"Row {idx}: " + " | ".join(normalized))
#     return "\n".join(lines)


# def _extract_pdf_text(file_path: str) -> str:
#     text_parts: List[str] = []
#     try:
#         import pdfplumber
#         with pdfplumber.open(file_path) as pdf:
#             for page in pdf.pages:
#                 page_text = page.extract_text() or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#     except Exception:
#         text_parts = []

#     if not text_parts:
#         try:
#             import fitz
#             doc = fitz.open(file_path)
#             for page in doc:
#                 page_text = page.get_text("text") or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#         except Exception:
#             text_parts = []

#     text = "\n".join(text_parts).strip()
#     if not text:
#         raise ValueError(PDF_TEXT_UNREADABLE_MESSAGE)
#     return _truncate(text)


# def _extract_docx_text(file_path: str) -> str:
#     try:
#         from docx import Document
#         doc = Document(file_path)
#         text_parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
#         for table_index, table in enumerate(doc.tables, start=1):
#             rows = []
#             for row in table.rows:
#                 rows.append([cell.text.replace("\n", " ").strip() for cell in row.cells])
#             table_text = _format_table(f"TABLE {table_index}:", rows)
#             if table_text:
#                 text_parts.append(table_text)
#         text = "\n".join(text_parts).strip()
#     except Exception as exc:
#         raise ValueError("Could not read DOCX content.") from exc

#     if not text:
#         raise ValueError("No readable text found in DOCX file.")
#     return _truncate(text)


# def _extract_xlsx_text(file_path: str) -> str:
#     try:
#         from openpyxl import load_workbook
#         workbook = load_workbook(file_path, read_only=True, data_only=True)
#         parts = []
#         for sheet in workbook.worksheets:
#             rows = [[cell for cell in row] for row in sheet.iter_rows(values_only=True)]
#             table_text = _format_table(f"SHEET: {sheet.title}", rows)
#             if table_text:
#                 parts.append(table_text)
#         workbook.close()
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)


# def _extract_xls_text(file_path: str) -> str:
#     try:
#         import pandas as pd
#         sheets = pd.read_excel(file_path, sheet_name=None, header=None, dtype=str, engine="xlrd")
#         parts = []
#         for sheet_name, frame in sheets.items():
#             frame = frame.dropna(how="all").dropna(axis=1, how="all")
#             rows = frame.where(pd.notna(frame), None).values.tolist()
#             table_text = _format_table(f"SHEET: {sheet_name}", rows)
#             if table_text:
#                 parts.append(table_text)
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)


# def _extract_csv_text(file_path: str) -> str:
#     last_error: Optional[Exception] = None
#     for encoding in ("utf-8-sig", "utf-8", "latin-1"):
#         try:
#             with open(file_path, newline="", encoding=encoding) as f:
#                 rows = list(csv.reader(f))
#             text = _format_table("CSV RUBRIC:", rows).strip()
#             if not text:
#                 raise ValueError("No readable text found in CSV rubric.")
#             return _truncate(text)
#         except Exception as exc:
#             last_error = exc
#     raise ValueError("Could not read CSV rubric content.") from last_error


# def extract_text(file_path: Optional[str], label: str, allowed_extensions: Set[str]) -> str:
#     if not file_path:
#         raise ValueError(f"{label} file path is missing.")
#     if not os.path.exists(file_path):
#         raise ValueError(f"{label} file was not found.")

#     ext = os.path.splitext(file_path)[1].lower()
#     if ext == ".doc":
#         raise ValueError(DOC_UNSUPPORTED_MESSAGE)

#     if ext not in allowed_extensions:
#         raise ValueError(UNSUPPORTED_FILE_MESSAGE)

#     if ext == ".pdf":
#         return _extract_pdf_text(file_path)

#     if ext == ".docx":
#         return _extract_docx_text(file_path)

#     if ext == ".xlsx":
#         return _extract_xlsx_text(file_path)

#     if ext == ".xls":
#         return _extract_xls_text(file_path)

#     if ext == ".csv":
#         return _extract_csv_text(file_path)

#     raise ValueError(UNSUPPORTED_FILE_MESSAGE)


# def extract_rubric_file_text(file_path: str) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "rubric", RUBRIC_EXTENSIONS)
#     return f"RUBRIC FILE: {filename}\n{content}"


# def extract_submission_file_text(file_path: str, index: int = 1) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "student submission", SUBMISSION_EXTENSIONS)
#     return f"FILE {index}: {filename}\n{content}"


# def submission_content(req: GradeRequest, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     parts: List[str] = []
#     seen_paths: Set[str] = set()
#     files = req.submission.files or []

#     for index, file_info in enumerate(files, start=1):
#         if not file_info.file_path or file_info.file_path in seen_paths:
#             continue
#         seen_paths.add(file_info.file_path)
#         heading = extract_submission_file_text(file_info.file_path, index)
#         if file_info.required_document_name:
#             heading = f"REQUIRED DOCUMENT: {file_info.required_document_name}\n{heading}"
#         parts.append(heading)

#     if not parts and req.submission.file_path:
#         parts.append(extract_submission_file_text(req.submission.file_path))

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Student submission content is missing or unreadable.")
#     return _truncate(text, max_chars)


# def rubric_content(req: GradeRequest, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     parts = []
#     if req.rubric.rubric_text and req.rubric.rubric_text.strip():
#         parts.append(req.rubric.rubric_text.strip())
#     if req.rubric.file_path:
#         parts.append(extract_rubric_file_text(req.rubric.file_path))

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Rubric content is missing or unreadable.")
#     return _truncate(text, max_chars)


# # UPDATED: prompt now includes strong markers and explicit DON'T REPEAT rule
# def _build_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None, enforce_no_repeat: bool = False) -> str:
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was invalid for this reason:
# {correction}

# Return corrected JSON only inside the markers.
# """
#     no_repeat = ""
#     if enforce_no_repeat:
#         no_repeat = "\nCRITICAL: DO NOT repeat any part of the submission or rubric. Your entire output must be ONLY the grading JSON inside the markers."

#     return f"""
# You are a medical education assessor. Grade the student portfolio using the rubric below.
# Your entire response must be a single JSON object enclosed by the markers <<<GRADING_JSON_START>>> and <<<GRADING_JSON_END>>>.
# {no_repeat}
# RULES:
# 1. Read all entries in the submission before scoring.
# 2. Strictly adhere to the rubric criteria and weightage.
# 3. Score each criterion 1-4 (4=Excellent, 3=Good, 2=Satisfactory, 1=Needs Improvement).
# 4. Weighted Score = score × weightage. Sum to get total_score out of 100.
# 5. Score only what is textually present. Do not infer.
# 6. Use entry requirements (if in rubric) for comprehensiveness and checklist.

# <<<GRADING_JSON_START>>>
# {{
#   "total_score": 0,
#   "rubric_criteria_feedback": [
#     {{"criterion": "Depth of reflection", "feedback": "..."}},
#     {{"criterion": "Critical thinking and evaluative abilities", "feedback": "..."}},
#     {{"criterion": "Creativity and Innovation", "feedback": "..."}},
#     {{"criterion": "Content and Comprehensiveness", "feedback": "..."}},
#     {{"criterion": "Structure, Presentation and Organization", "feedback": "..."}}
#   ],
#   "overall_strengths": "string",
#   "overall_weaknesses": "string",
#   "checklist": [
#     {{"item": "Checklist item 1", "status": "Present"}},
#     ...
#   ]
# }}
# <<<GRADING_JSON_END>>>

# Rubric:
# \"\"\"
# {rubric_text}
# \"\"\"

# Student submission:
# \"\"\"
# {submission_text}
# \"\"\"
# {correction_block}
# """


# def _extract_first_json(raw_output: str) -> Dict[str, Any]:
#     raw_output = (raw_output or "").strip()
#     if not raw_output:
#         raise ValueError("Model returned empty output.")

#     # UPDATED: try to extract the marker-delimited block first
#     if "GRADING_JSON_START" in raw_output and "GRADING_JSON_END" in raw_output:
#         start_idx = raw_output.index("GRADING_JSON_START") + len("GRADING_JSON_START")
#         end_idx = raw_output.index("GRADING_JSON_END")
#         block = raw_output[start_idx:end_idx].strip()
#         if block:
#             raw_output = block

#     # Now parse as before
#     if "```" in raw_output:
#         parts = raw_output.split("```")
#         candidates = [p for p in parts if "{" in p]
#         if candidates:
#             raw_output = candidates[0].strip()
#             if raw_output.lower().startswith("json"):
#                 raw_output = raw_output[4:].strip()

#     try:
#         return json.loads(raw_output)
#     except json.JSONDecodeError:
#         pass

#     decoder = json.JSONDecoder()
#     for i, ch in enumerate(raw_output):
#         if ch == "{":
#             try:
#                 obj, _ = decoder.raw_decode(raw_output[i:])
#                 return obj
#             except json.JSONDecodeError:
#                 continue

#     raise ValueError("Model did not return a valid JSON object.")


# def _normalize_grading_json(obj: Dict[str, Any]) -> Dict[str, Any]:
#     normalized: Dict[str, Any] = {}

#     for key in ("total_score", "score", "final_score", "marks", "grade_points"):
#         if key in obj:
#             try:
#                 normalized["total_score"] = round(float(obj[key]), 2)
#             except (ValueError, TypeError):
#                 pass
#             break
#     if "total_score" not in normalized:
#         normalized["total_score"] = 0.0

#     feedback = obj.get("rubric_criteria_feedback") or obj.get("criteria_feedback") or obj.get("rubric_feedback") or []
#     if not isinstance(feedback, list):
#         feedback = []
#     normalized["rubric_criteria_feedback"] = feedback

#     strengths = obj.get("overall_strengths") or obj.get("strengths") or obj.get("overall_strength") or ""
#     normalized["overall_strengths"] = str(strengths) if strengths else "Not provided."

#     weaknesses = obj.get("overall_weaknesses") or obj.get("weaknesses") or obj.get("overall_weakness") or ""
#     normalized["overall_weaknesses"] = str(weaknesses) if weaknesses else "Not provided."

#     checklist = obj.get("checklist") or obj.get("checklist_items") or obj.get("presence_checklist") or []
#     if not isinstance(checklist, list):
#         checklist = []
#     normalized["checklist"] = checklist

#     return normalized


# def _validate_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")

#     obj = _normalize_grading_json(obj)

#     score = obj.get("total_score")
#     try:
#         score = float(score)
#     except (ValueError, TypeError):
#         score = 0.0
#     if score < 0 or score > 100:
#         score = 0.0
#     obj["total_score"] = round(score, 2)

#     feedback_list = obj.get("rubric_criteria_feedback", [])
#     if not isinstance(feedback_list, list):
#         feedback_list = []
#     cleaned_feedback = []
#     for item in feedback_list:
#         if isinstance(item, dict) and "criterion" in item and "feedback" in item:
#             cleaned_feedback.append({
#                 "criterion": str(item["criterion"]).strip() or "Unnamed criterion",
#                 "feedback": str(item["feedback"]).strip() or "No feedback provided."
#             })
#         elif isinstance(item, dict) and "name" in item:
#             cleaned_feedback.append({
#                 "criterion": str(item["name"]).strip(),
#                 "feedback": str(item.get("feedback", item.get("comment", ""))).strip() or "No feedback provided."
#             })
#     default_criteria = [
#         "Depth of reflection",
#         "Critical thinking and evaluative abilities",
#         "Creativity and Innovation",
#         "Content and Comprehensiveness",
#         "Structure, Presentation and Organization"
#     ]
#     while len(cleaned_feedback) < 5:
#         idx = len(cleaned_feedback)
#         cleaned_feedback.append({
#             "criterion": default_criteria[idx % len(default_criteria)],
#             "feedback": "No feedback available from model."
#         })
#     obj["rubric_criteria_feedback"] = cleaned_feedback[:5]

#     obj["overall_strengths"] = str(obj.get("overall_strengths", "")).strip() or "Not provided."
#     obj["overall_weaknesses"] = str(obj.get("overall_weaknesses", "")).strip() or "Not provided."

#     checklist = obj.get("checklist", [])
#     if not isinstance(checklist, list):
#         checklist = []
#     cleaned_checklist = []
#     for item in checklist:
#         if isinstance(item, dict) and "item" in item and "status" in item:
#             status = str(item["status"]).strip()
#             if status.lower() not in ("present", "not present"):
#                 status = "Not Present"
#             cleaned_checklist.append({
#                 "item": str(item["item"]).strip() or "Checklist item",
#                 "status": status
#             })
#         elif isinstance(item, dict) and "name" in item:
#             cleaned_checklist.append({
#                 "item": str(item["name"]).strip(),
#                 "status": str(item.get("status", item.get("present", "Not Present"))).strip()
#             })
#     while len(cleaned_checklist) < 5:
#         cleaned_checklist.append({
#             "item": f"Checklist item {len(cleaned_checklist)+1}",
#             "status": "Not Present"
#         })
#     obj["checklist"] = cleaned_checklist[:5]

#     return obj


# def _call_ollama(prompt: str) -> Dict[str, Any]:
#     client = ollama.Client(host=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT_SECONDS)

#     options = {}
#     if OLLAMA_TEMPERATURE is not None:
#         options["temperature"] = OLLAMA_TEMPERATURE
#     if OLLAMA_NUM_PREDICT:
#         options["num_predict"] = OLLAMA_NUM_PREDICT

#     chat_kwargs = {
#         "model": OLLAMA_MODEL,
#         "messages": [{"role": "user", "content": prompt}],
#         "stream": False,
#     }
#     if OLLAMA_JSON_MODE:
#         chat_kwargs["format"] = "json"
#     if options:
#         chat_kwargs["options"] = options

#     response = client.chat(**chat_kwargs)
#     raw_output = response["message"]["content"]

#     if DEBUG_RAW_OUTPUT:
#         print("=" * 80, file=sys.stderr)
#         print("RAW LLM OUTPUT:", file=sys.stderr)
#         print(raw_output, file=sys.stderr)
#         print("=" * 80, file=sys.stderr)

#     return _extract_first_json(raw_output)

# # UPDATED: better formatting – bullet points for rubric criteria, proper spacing, plain compat line
# def _render_report(req: GradeRequest, structured: Dict[str, Any], warning: str = "") -> str:
#     # This line contains all old section names to satisfy backend validation
#     intro_line = (
#         "This report includes an Overall Evaluation, highlights Strengths of the Submission, "
#         "identifies Areas That Need Improvement, offers Suggestions for Improvement, "
#         "and concludes with an Overall Comment."
#     )

#     # 1. Rubric criteria feedback (bullet list with spacing)
#     criteria_lines = ["1. The rubric criteria"]
#     for crit in structured["rubric_criteria_feedback"]:
#         criteria_lines.append(f"- {crit['criterion']}: {crit['feedback']}")
#         criteria_lines.append("")   # blank line for readability

#     # 2. Overall strengths / weaknesses
#     strengths = f"1) Overall strengths: {structured['overall_strengths']}"
#     weaknesses = f"2) Overall weaknesses: {structured['overall_weaknesses']}"

#     # 3. Checklist (bullet list)
#     checklist_lines = ["3. Presence of absence of checklist items."]
#     for item in structured["checklist"]:
#         checklist_lines.append(f"- {item['item']}: {item['status']}")

#     warning_section = ""
#     if warning:
#         warning_section = f"\n[SYSTEM NOTE: {warning}]\n"

#     # Only the body – no title, no student info, no score line
#     body = f"""{intro_line}

# {warning_section}
# Feedback criteria for all entries of the portfolio
# {chr(10).join(criteria_lines)}

# 2. Overall strength and weaknesses
# {strengths}
# {weaknesses}

# {chr(10).join(checklist_lines)}
# """
#     return body

# def _render_feedback(structured: Dict[str, Any]) -> str:
#     return f"""AI Learning Feedback Report

# 1. Overall Feedback
# {structured["overall_feedback"]}

# 2. Main Improvement Areas
# {_as_bullets(structured["main_improvement_areas"])}

# 3. Practical Suggestions
# {_as_bullets(structured["practical_suggestions"])}

# 4. Final Advice
# {structured["final_advice"]}
# """


# def _validate_report_text(report: str) -> None:
#     if not report.strip():
#         raise ValueError("Generated report is empty.")
#     required_sections = [
#         "Feedback criteria for all entries of the portfolio",
#         "1. The rubric criteria",
#         "2. Overall strength and weaknesses",
#         "3. Presence of absence of checklist items.",
#     ]
#     missing = [section for section in required_sections if section not in report]
#     if missing:
#         raise ValueError(f"Generated report is missing sections: {', '.join(missing)}")


# def _validate_feedback_text(feedback: str) -> None:
#     if not feedback.strip():
#         raise ValueError("Generated feedback is empty.")
#     required_sections = [
#         "AI Learning Feedback Report",
#         "1. Overall Feedback",
#         "2. Main Improvement Areas",
#         "3. Practical Suggestions",
#         "4. Final Advice",
#     ]
#     missing = [section for section in required_sections if section not in feedback]
#     if missing:
#         raise ValueError(f"Generated feedback is missing sections: {', '.join(missing)}")
#     if _feedback_text_has_unsafe_content(feedback):
#         raise ValueError("Generated feedback contained restricted grading or rubric language.")


# @app.get("/health")
# def health():
#     return {
#         "ok": True,
#         "ollama_base_url": OLLAMA_BASE_URL,
#         "ollama_model": OLLAMA_MODEL,
#     }


# # UPDATED: grade endpoint now uses 3 retries, shortens input for small models, and enforces no-repeat on retry
# @app.post("/grade", response_model=GradeResponse)
# def grade(req: GradeRequest):
#     raw_output_debug = ""
#     try:
#         # For small models, drastically reduce the input size to avoid confusion
#         max_input = MAX_INPUT_CHARS_FOR_SMALL_MODEL if "4b" in OLLAMA_MODEL.lower() or "3b" in OLLAMA_MODEL.lower() else MAX_EXTRACTED_CHARS
#         rubric_text = rubric_content(req, max_input)
#         submission_text = submission_content(req, max_input)

#         first_error = None
#         structured = None

#         for attempt in range(3):  # UPDATED: 3 attempts
#             try:
#                 enforce_no_repeat = (attempt >= 1)  # on retries, shout louder
#                 prompt = _build_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt > 0 and first_error else None,
#                     enforce_no_repeat=enforce_no_repeat,
#                 )
#                 raw_response = _call_ollama(prompt)
#                 raw_output_debug = json.dumps(raw_response, indent=2)
#                 structured = _validate_structured(raw_response)

#                 # If the normalized score is 0 and all feedback is default, it's likely a failed response.
#                 if structured["total_score"] == 0.0 and all(
#                     "No feedback" in crit["feedback"] for crit in structured["rubric_criteria_feedback"]
#                 ):
#                     raise ValueError("Model output appears to be default placeholders; retrying.")

#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 2:  # last attempt
#                     print("=" * 80, file=sys.stderr)
#                     print(f"GRADING FAILED after 3 attempts. Last raw LLM output:\n{raw_output_debug}", file=sys.stderr)
#                     print("=" * 80, file=sys.stderr)
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid grading output.")

#         warning = ""
#         if structured["total_score"] == 0.0 and all(
#             "No feedback" in crit["feedback"] for crit in structured["rubric_criteria_feedback"]
#         ):
#             warning = "The model's output was incomplete; some sections have been filled with defaults. Please review manually."

#         report = _render_report(req, structured, warning)
#         _validate_report_text(report)

#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="graded",
#             ai_grade=structured["total_score"],
#             ai_report_text=report,
#             ai_model=OLLAMA_MODEL,
#         )
#     except Exception as exc:
#         if raw_output_debug:
#             print("=" * 80, file=sys.stderr)
#             print(f"GRADING FAILED with error: {exc}\nRaw LLM output at failure:\n{raw_output_debug}", file=sys.stderr)
#             print("=" * 80, file=sys.stderr)
#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             ai_grade=None,
#             ai_report_text=None,
#             ai_model=OLLAMA_MODEL,
#             error=str(exc),
#         )


# @app.post("/feedback", response_model=FeedbackResponse)
# def feedback(req: GradeRequest):
#     try:
#         rubric_text = rubric_content(req)
#         submission_text = submission_content(req)

#         first_error = None
#         structured = None

#         for attempt in range(2):
#             try:
#                 prompt = _build_feedback_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt == 1 and first_error else None,
#                 )
#                 structured = _validate_feedback_structured(_call_ollama(prompt))
#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 1:
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid feedback output.")

#         feedback_text = _render_feedback(structured)
#         _validate_feedback_text(feedback_text)

#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="completed",
#             feedback_text=feedback_text,
#             ai_model=OLLAMA_MODEL,
#         )
#     except Exception as exc:
#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             feedback_text=None,
#             ai_model=OLLAMA_MODEL,
#             error=str(exc),
#         )






# #updated 2  code with new build promt and report structure and student feedback fn.
# import json
# import os
# import re
# import csv
# import sys
# from datetime import datetime
# from pathlib import Path
# from typing import Any, Dict, List, Optional, Set

# from dotenv import load_dotenv
# from fastapi import FastAPI
# from pydantic import BaseModel

# import ollama

# load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

# app = FastAPI(title="AIAGS ML Service", version="2.0")


# def _env_int(name: str, default: int) -> int:
#     raw_value = os.getenv(name, str(default))
#     clean_value = raw_value.split("#", 1)[0].strip()
#     try:
#         return int(clean_value)
#     except ValueError as exc:
#         raise ValueError(f"{name} must be an integer value, got {raw_value!r}") from exc


# def _env_float(name: str, default: float) -> float:
#     raw_value = os.getenv(name, str(default))
#     clean_value = raw_value.split("#", 1)[0].strip()
#     try:
#         return float(clean_value)
#     except ValueError as exc:
#         raise ValueError(f"{name} must be a float value, got {raw_value!r}") from exc


# def _env_bool(name: str, default: bool) -> bool:
#     raw_value = os.getenv(name, str(default)).strip().lower()
#     return raw_value in ("1", "true", "yes", "on")


# OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
# OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", os.getenv("AIAGS_OLLAMA_MODEL", "llama3.1:8b"))

# print(f"Using Ollama model: {OLLAMA_MODEL}")






# OLLAMA_TIMEOUT_SECONDS = _env_int("OLLAMA_TIMEOUT_SECONDS", 120)
# MAX_EXTRACTED_CHARS = _env_int("MAX_EXTRACTED_CHARS", 30000)
# MAX_INPUT_CHARS_FOR_SMALL_MODEL = _env_int("MAX_INPUT_CHARS_FOR_SMALL_MODEL", 4000)   # UPDATED: shrink input for 4B models

# OLLAMA_JSON_MODE = _env_bool("OLLAMA_JSON_MODE", True)
# OLLAMA_TEMPERATURE = _env_float("OLLAMA_TEMPERATURE", 0.3)
# OLLAMA_NUM_PREDICT = _env_int("OLLAMA_NUM_PREDICT", 4096)
# DEBUG_RAW_OUTPUT = _env_bool("DEBUG_RAW_OUTPUT", False)


# # Optionally, print the other settings for verification
# print(f"MAX_EXTRACTED_CHARS = {MAX_EXTRACTED_CHARS}")
# print(f"MAX_INPUT_CHARS_FOR_SMALL_MODEL = {MAX_INPUT_CHARS_FOR_SMALL_MODEL}")

# RUBRIC_EXTENSIONS = {".xlsx", ".xls", ".csv", ".pdf", ".docx"}
# SUBMISSION_EXTENSIONS = {".pdf", ".docx"}
# UNSUPPORTED_FILE_MESSAGE = (
#     "Unsupported file type. Please upload rubric as Excel/PDF/DOCX and assignment submission as PDF or DOCX."
# )
# DOC_UNSUPPORTED_MESSAGE = "DOC files are not supported. Please convert the document to DOCX or PDF and upload again."
# PDF_TEXT_UNREADABLE_MESSAGE = (
#     "PDF text could not be extracted. The file may be scanned or image-based. "
#     "Please upload a text-based PDF or DOCX."
# )


# class AssignmentInfo(BaseModel):
#     assignment_id: int
#     assignment_name: str
#     course_name: Optional[str] = None
#     batch: Optional[str] = None
#     department: Optional[str] = None
#     start_date: Optional[str] = None
#     deadline_date: Optional[str] = None
#     remark: Optional[str] = None


# class StudentInfo(BaseModel):
#     student_no: str


# class RubricInfo(BaseModel):
#     rubric_id: int
#     rubric_name: Optional[str] = None
#     rubric_text: Optional[str] = None
#     file_path: Optional[str] = None
#     file_mime: Optional[str] = None
#     file_original_name: Optional[str] = None


# class SubmissionFileInfo(BaseModel):
#     file_id: Optional[int] = None
#     file_path: str
#     file_original_name: Optional[str] = None
#     file_mime: Optional[str] = None
#     required_document_name: Optional[str] = None


# class SubmissionInfo(BaseModel):
#     portfolio_id: int
#     file_path: str
#     portfolio_link: Optional[str] = None
#     uploaded_at: Optional[str] = None
#     files: Optional[List[SubmissionFileInfo]] = None


# class GradeRequest(BaseModel):
#     portfolio_id: int
#     assignment: AssignmentInfo
#     student: StudentInfo
#     rubric: RubricInfo
#     submission: SubmissionInfo


# class GradeResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     ai_grade: Optional[float] = None
#     ai_report_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None


# class FeedbackResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     feedback_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None


# REQUIRED_KEYS = [
#     "total_score",
#     "rubric_criteria_feedback",
#     "overall_strengths",
#     "overall_weaknesses",
#     # "checklist",
# ]

# FEEDBACK_REQUIRED_KEYS = [
#     "overall_feedback",
#     "main_improvement_areas",
#     "practical_suggestions",
#     "final_advice",
# ]

# UNSAFE_FEEDBACK_PATTERNS = [
#     r"\bscore\b",
#     r"\bgrade\b",
#     r"\bmarks?\b",
#     r"\bpoints?\b",
#     r"\brubric\b",
#     r"\bcriteria?\b",
#     r"\bcriterion\b",
#     r"\bawarded\b",
#     r"\bgrading\b",
#     r"\b\d{1,3}\s*(/|out of)\s*100\b",
#     r"\b\d{1,3}\s*%\b",
# ]

# FEEDBACK_SAFE_FALLBACKS = {
#     "overall_feedback": "Your submission has been reviewed for learning support. Focus on making your explanation clearer, more complete, and easier to follow.",
#     "main_improvement_areas": "Improve clarity, organization, evidence, and completeness in the main sections of your work.",
#     "practical_suggestions": "Review each section, add clearer explanations, support important statements, and check formatting before submitting again.",
#     "final_advice": "Revise your work carefully and use this feedback to strengthen your submission before official evaluation.",
# }


# def _truncate(text: str, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     text = (text or "").strip()
#     if len(text) <= max_chars:
#         return text
#     return text[:max_chars] + "\n\n[Content truncated for AI processing.]"


# def _format_table(title: str, rows: List[List[Any]]) -> str:
#     cleaned_rows: List[List[str]] = []
#     for row in rows:
#         cleaned = [str(cell).strip() if cell is not None else "" for cell in row]
#         if any(cleaned):
#             cleaned_rows.append(cleaned)

#     if not cleaned_rows:
#         return ""

#     max_cols = max(len(row) for row in cleaned_rows)
#     lines = [title]
#     for idx, row in enumerate(cleaned_rows, start=1):
#         normalized = row + [""] * (max_cols - len(row))
#         lines.append(f"Row {idx}: " + " | ".join(normalized))
#     return "\n".join(lines)


# def _extract_pdf_text(file_path: str) -> str:
#     text_parts: List[str] = []
#     try:
#         import pdfplumber
#         with pdfplumber.open(file_path) as pdf:
#             for page in pdf.pages:
#                 page_text = page.extract_text() or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#     except Exception:
#         text_parts = []

#     if not text_parts:
#         try:
#             import fitz
#             doc = fitz.open(file_path)
#             for page in doc:
#                 page_text = page.get_text("text") or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#         except Exception:
#             text_parts = []

#     text = "\n".join(text_parts).strip()
#     if not text:
#         raise ValueError(PDF_TEXT_UNREADABLE_MESSAGE)
#     return _truncate(text)


# def _extract_docx_text(file_path: str) -> str:
#     try:
#         from docx import Document
#         doc = Document(file_path)
#         text_parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
#         for table_index, table in enumerate(doc.tables, start=1):
#             rows = []
#             for row in table.rows:
#                 rows.append([cell.text.replace("\n", " ").strip() for cell in row.cells])
#             table_text = _format_table(f"TABLE {table_index}:", rows)
#             if table_text:
#                 text_parts.append(table_text)
#         text = "\n".join(text_parts).strip()
#     except Exception as exc:
#         raise ValueError("Could not read DOCX content.") from exc

#     if not text:
#         raise ValueError("No readable text found in DOCX file.")
#     return _truncate(text)


# def _extract_xlsx_text(file_path: str) -> str:
#     try:
#         from openpyxl import load_workbook
#         workbook = load_workbook(file_path, read_only=True, data_only=True)
#         parts = []
#         for sheet in workbook.worksheets:
#             rows = [[cell for cell in row] for row in sheet.iter_rows(values_only=True)]
#             table_text = _format_table(f"SHEET: {sheet.title}", rows)
#             if table_text:
#                 parts.append(table_text)
#         workbook.close()
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)


# def _extract_xls_text(file_path: str) -> str:
#     try:
#         import pandas as pd
#         sheets = pd.read_excel(file_path, sheet_name=None, header=None, dtype=str, engine="xlrd")
#         parts = []
#         for sheet_name, frame in sheets.items():
#             frame = frame.dropna(how="all").dropna(axis=1, how="all")
#             rows = frame.where(pd.notna(frame), None).values.tolist()
#             table_text = _format_table(f"SHEET: {sheet_name}", rows)
#             if table_text:
#                 parts.append(table_text)
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)


# def _extract_csv_text(file_path: str) -> str:
#     last_error: Optional[Exception] = None
#     for encoding in ("utf-8-sig", "utf-8", "latin-1"):
#         try:
#             with open(file_path, newline="", encoding=encoding) as f:
#                 rows = list(csv.reader(f))
#             text = _format_table("CSV RUBRIC:", rows).strip()
#             if not text:
#                 raise ValueError("No readable text found in CSV rubric.")
#             return _truncate(text)
#         except Exception as exc:
#             last_error = exc
#     raise ValueError("Could not read CSV rubric content.") from last_error


# def extract_text(file_path: Optional[str], label: str, allowed_extensions: Set[str]) -> str:
#     if not file_path:
#         raise ValueError(f"{label} file path is missing.")
#     if not os.path.exists(file_path):
#         raise ValueError(f"{label} file was not found.")

#     ext = os.path.splitext(file_path)[1].lower()
#     if ext == ".doc":
#         raise ValueError(DOC_UNSUPPORTED_MESSAGE)

#     if ext not in allowed_extensions:
#         raise ValueError(UNSUPPORTED_FILE_MESSAGE)

#     if ext == ".pdf":
#         return _extract_pdf_text(file_path)

#     if ext == ".docx":
#         return _extract_docx_text(file_path)

#     if ext == ".xlsx":
#         return _extract_xlsx_text(file_path)

#     if ext == ".xls":
#         return _extract_xls_text(file_path)

#     if ext == ".csv":
#         return _extract_csv_text(file_path)

#     raise ValueError(UNSUPPORTED_FILE_MESSAGE)


# def extract_rubric_file_text(file_path: str) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "rubric", RUBRIC_EXTENSIONS)
#     return f"RUBRIC FILE: {filename}\n{content}"


# def extract_submission_file_text(file_path: str, index: int = 1) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "student submission", SUBMISSION_EXTENSIONS)
#     return f"FILE {index}: {filename}\n{content}"


# def submission_content(req: GradeRequest, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     parts: List[str] = []
#     seen_paths: Set[str] = set()
#     files = req.submission.files or []

#     for index, file_info in enumerate(files, start=1):
#         if not file_info.file_path or file_info.file_path in seen_paths:
#             continue
#         seen_paths.add(file_info.file_path)
#         heading = extract_submission_file_text(file_info.file_path, index)
#         if file_info.required_document_name:
#             heading = f"REQUIRED DOCUMENT: {file_info.required_document_name}\n{heading}"
#         parts.append(heading)

#     if not parts and req.submission.file_path:
#         parts.append(extract_submission_file_text(req.submission.file_path))

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Student submission content is missing or unreadable.")
#     return _truncate(text, max_chars)


# def rubric_content(req: GradeRequest, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     parts = []
#     if req.rubric.rubric_text and req.rubric.rubric_text.strip():
#         parts.append(req.rubric.rubric_text.strip())
#     if req.rubric.file_path:
#         parts.append(extract_rubric_file_text(req.rubric.file_path))

#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Rubric content is missing or unreadable.")
#     return _truncate(text, max_chars)


# # UPDATED: Grading prompt with markers and no-repeat rule
# def _build_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None, enforce_no_repeat: bool = False) -> str:
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was invalid for this reason:
# {correction}

# Return corrected JSON only inside the markers.
# """
#     no_repeat = ""
#     if enforce_no_repeat:
#         no_repeat = "\nCRITICAL: DO NOT repeat any part of the submission or rubric. Your entire output must be ONLY the grading JSON inside the markers."

#     return f"""
# You are a medical education assessor with postgraduate qualifications. Grade the student portfolio using the rubric below.
# Your entire response must be a single JSON object enclosed by the markers <<<GRADING_JSON_START>>> and <<<GRADING_JSON_END>>>.
# {no_repeat}
# RULES:
# 1. Read all entries in the submission before scoring.
# 2. Strictly adhere to the rubric criteria and weightage.
# 3. Score each criterion 1-4 (4=Excellent, 3=Good, 2=Satisfactory, 1=Needs Improvement).
# 4. Weighted Score = score × weightage. Sum to get total_score out of 100.
# 5. Score only what is textually present. Do not infer.
# <<<GRADING_JSON_START>>>
# {{
#   "total_score": 0,
#   "rubric_criteria_feedback": [
#     {{"criterion": "Depth of reflection", "feedback": "..."}},
#     {{"criterion": "Critical thinking and evaluative abilities", "feedback": "..."}},
#     {{"criterion": "Creativity and Innovation", "feedback": "..."}},
#     {{"criterion": "Content and Comprehensiveness", "feedback": "..."}},
#     {{"criterion": "Structure, Presentation and Organization", "feedback": "..."}}
#   ],
#   "overall_strengths": "string",
#   "overall_weaknesses": "string",
# }}
# <<<GRADING_JSON_END>>>

# Rubric:
# \"\"\"
# {rubric_text}
# \"\"\"

# Student submission:
# \"\"\"
# {submission_text}
# \"\"\"
# {correction_block}
# """


# # UPDATED: Feedback prompt with markers and no-repeat rule
# def _build_feedback_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None, enforce_no_repeat: bool = False) -> str:
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was unsafe or invalid for this reason:
# {correction}

# Return corrected JSON only inside the markers.
# """
#     no_repeat = ""
#     if enforce_no_repeat:
#         no_repeat = "\nCRITICAL: DO NOT repeat any part of the submission or rubric. Your entire output must be ONLY the feedback JSON inside the markers."

#     return f"""
# You are a helpful academic writing assistant giving private learning feedback to a student.
# Use the assignment details, uploaded rubric, and student submission internally only.
# Do not reveal the rubric, rubric criteria, hidden grading logic, marks, score, grade, awarded marks, or grading breakdown.
# {no_repeat}

# Assignment:
# - Name: {req.assignment.assignment_name}
# - Course: {req.assignment.course_name or "Not specified"}
# - Batch: {req.assignment.batch or "Not specified"}
# - Department: {req.assignment.department or "Not specified"}

# Student submission content:
# \"\"\"
# {submission_text}
# \"\"\"

# Internal rubric content. Use it only to guide improvement advice. Do not mention or quote it:
# \"\"\"
# {rubric_text}
# \"\"\"

# Return ONLY one valid JSON object enclosed by the markers <<<FEEDBACK_JSON_START>>> and <<<FEEDBACK_JSON_END>>> with this exact shape:
# <<<FEEDBACK_JSON_START>>>
# {{
#   "overall_feedback": "Simple, helpful summary of the submission.",
#   "main_improvement_areas": ["Area 1", "Area 2"],
#   "practical_suggestions": ["Suggestion 1", "Suggestion 2"],
#   "final_advice": "Encouraging final advice for improving before official evaluation."
# }}
# <<<FEEDBACK_JSON_END>>>

# Rules:
# - Do not mention score, grade, marks, points, percentages, rubric, criteria, awarded marks, or grading breakdown.
# - Give only improvement advice.
# - Write in simple, student-friendly language.
# - Do not include markdown fences.
# - Do not include text outside the markers.
# {correction_block}
# """


# # UPDATED: JSON extraction now handles both grading and feedback markers
# def _extract_first_json(raw_output: str) -> Dict[str, Any]:
#     raw_output = (raw_output or "").strip()
#     if not raw_output:
#         raise ValueError("Model returned empty output.")

#     # Try grading markers
#     if "GRADING_JSON_START" in raw_output and "GRADING_JSON_END" in raw_output:
#         start_idx = raw_output.index("GRADING_JSON_START") + len("GRADING_JSON_START")
#         end_idx = raw_output.index("GRADING_JSON_END")
#         block = raw_output[start_idx:end_idx].strip()
#         if block:
#             raw_output = block

#     # Try feedback markers
#     if "FEEDBACK_JSON_START" in raw_output and "FEEDBACK_JSON_END" in raw_output:
#         start_idx = raw_output.index("FEEDBACK_JSON_START") + len("FEEDBACK_JSON_START")
#         end_idx = raw_output.index("FEEDBACK_JSON_END")
#         block = raw_output[start_idx:end_idx].strip()
#         if block:
#             raw_output = block

#     # Now parse
#     if "```" in raw_output:
#         parts = raw_output.split("```")
#         candidates = [p for p in parts if "{" in p]
#         if candidates:
#             raw_output = candidates[0].strip()
#             if raw_output.lower().startswith("json"):
#                 raw_output = raw_output[4:].strip()

#     try:
#         return json.loads(raw_output)
#     except json.JSONDecodeError:
#         pass

#     decoder = json.JSONDecoder()
#     for i, ch in enumerate(raw_output):
#         if ch == "{":
#             try:
#                 obj, _ = decoder.raw_decode(raw_output[i:])
#                 return obj
#             except json.JSONDecodeError:
#                 continue

#     raise ValueError("Model did not return a valid JSON object.")


# def _normalize_grading_json(obj: Dict[str, Any]) -> Dict[str, Any]:
#     normalized: Dict[str, Any] = {}

#     for key in ("total_score", "score", "final_score", "marks", "grade_points"):
#         if key in obj:
#             try:
#                 normalized["total_score"] = round(float(obj[key]), 2)
#             except (ValueError, TypeError):
#                 pass
#             break
#     if "total_score" not in normalized:
#         normalized["total_score"] = 0.0

#     feedback = obj.get("rubric_criteria_feedback") or obj.get("criteria_feedback") or obj.get("rubric_feedback") or []
#     if not isinstance(feedback, list):
#         feedback = []
#     normalized["rubric_criteria_feedback"] = feedback

#     strengths = obj.get("overall_strengths") or obj.get("strengths") or obj.get("overall_strength") or ""
#     normalized["overall_strengths"] = str(strengths) if strengths else "Not provided."

#     weaknesses = obj.get("overall_weaknesses") or obj.get("weaknesses") or obj.get("overall_weakness") or ""
#     normalized["overall_weaknesses"] = str(weaknesses) if weaknesses else "Not provided."

#     # checklist = obj.get("checklist") or obj.get("checklist_items") or obj.get("presence_checklist") or []
#     # if not isinstance(checklist, list):
#     #     checklist = []
#     # normalized["checklist"] = checklist

#     return normalized


# def _validate_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")

#     obj = _normalize_grading_json(obj)

#     score = obj.get("total_score")
#     try:
#         score = float(score)
#     except (ValueError, TypeError):
#         score = 0.0
#     if score < 0 or score > 100:
#         score = 0.0
#     obj["total_score"] = round(score, 2)

#     feedback_list = obj.get("rubric_criteria_feedback", [])
#     if not isinstance(feedback_list, list):
#         feedback_list = []
#     cleaned_feedback = []
#     for item in feedback_list:
#         if isinstance(item, dict) and "criterion" in item and "feedback" in item:
#             cleaned_feedback.append({
#                 "criterion": str(item["criterion"]).strip() or "Unnamed criterion",
#                 "feedback": str(item["feedback"]).strip() or "No feedback provided."
#             })
#         elif isinstance(item, dict) and "name" in item:
#             cleaned_feedback.append({
#                 "criterion": str(item["name"]).strip(),
#                 "feedback": str(item.get("feedback", item.get("comment", ""))).strip() or "No feedback provided."
#             })
#     default_criteria = [
#         "Depth of reflection",
#         "Critical thinking and evaluative abilities",
#         "Creativity and Innovation",
#         "Content and Comprehensiveness",
#         "Structure, Presentation and Organization"
#     ]
#     while len(cleaned_feedback) < 5:
#         idx = len(cleaned_feedback)
#         cleaned_feedback.append({
#             "criterion": default_criteria[idx % len(default_criteria)],
#             "feedback": "No feedback available from model."
#         })
#     obj["rubric_criteria_feedback"] = cleaned_feedback[:5]

#     obj["overall_strengths"] = str(obj.get("overall_strengths", "")).strip() or "Not provided."
#     obj["overall_weaknesses"] = str(obj.get("overall_weaknesses", "")).strip() or "Not provided."

#     #commented because we dont want checklist 
#     # checklist = obj.get("checklist", [])
#     # if not isinstance(checklist, list):
#     #     checklist = []
#     # cleaned_checklist = []
#     # for item in checklist:
#     #     if isinstance(item, dict) and "item" in item and "status" in item:
#     #         status = str(item["status"]).strip()
#     #         if status.lower() not in ("present", "not present"):
#     #             status = "Not Present"
#     #         cleaned_checklist.append({
#     #             "item": str(item["item"]).strip() or "Checklist item",
#     #             "status": status
#     #         })
#     #     elif isinstance(item, dict) and "name" in item:
#     #         cleaned_checklist.append({
#     #             "item": str(item["name"]).strip(),
#     #             "status": str(item.get("status", item.get("present", "Not Present"))).strip()
#     #         })
#     # # commented because we want to keep all checklist items, not just 5
#     # # while len(cleaned_checklist) < 5:
#     # #     cleaned_checklist.append({
#     # #         "item": f"Checklist item {len(cleaned_checklist)+1}",
#     # #         "status": "Not Present"
#     # #     })
#     # # obj["checklist"] = cleaned_checklist[:5]
       
#     # # No padding or truncation – keep all items
#     # obj["checklist"] = cleaned_checklist
    

#     return obj


# # UPDATED: Feedback validation now normalizes keys and falls back to defaults
# def _validate_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")

#     # Normalize alternative keys
#     normalized = {}
#     normalized["overall_feedback"] = str(obj.get("overall_feedback") or obj.get("summary") or obj.get("feedback") or "").strip()
#     areas = obj.get("main_improvement_areas") or obj.get("improvement_areas") or obj.get("areas") or []
#     if not isinstance(areas, list):
#         areas = [str(areas)] if areas else []
#     normalized["main_improvement_areas"] = [str(a).strip() for a in areas if str(a).strip()]

#     suggestions = obj.get("practical_suggestions") or obj.get("suggestions") or obj.get("tips") or []
#     if not isinstance(suggestions, list):
#         suggestions = [str(suggestions)] if suggestions else []
#     normalized["practical_suggestions"] = [str(s).strip() for s in suggestions if str(s).strip()]

#     normalized["final_advice"] = str(obj.get("final_advice") or obj.get("conclusion") or obj.get("advice") or "").strip()

#     # Fill empty with safe fallbacks
#     if not normalized["overall_feedback"]:
#         normalized["overall_feedback"] = FEEDBACK_SAFE_FALLBACKS["overall_feedback"]
#     if not normalized["main_improvement_areas"]:
#         normalized["main_improvement_areas"] = [FEEDBACK_SAFE_FALLBACKS["main_improvement_areas"]]
#     if not normalized["practical_suggestions"]:
#         normalized["practical_suggestions"] = [FEEDBACK_SAFE_FALLBACKS["practical_suggestions"]]
#     if not normalized["final_advice"]:
#         normalized["final_advice"] = FEEDBACK_SAFE_FALLBACKS["final_advice"]

#     # Sanitize for restricted words
#     return _sanitize_feedback_structured(normalized)


# def _call_ollama(prompt: str) -> Dict[str, Any]:
#     client = ollama.Client(host=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT_SECONDS)

#     options = {}
#     if OLLAMA_TEMPERATURE is not None:
#         options["temperature"] = OLLAMA_TEMPERATURE
#     if OLLAMA_NUM_PREDICT:
#         options["num_predict"] = OLLAMA_NUM_PREDICT

#     chat_kwargs = {
#         "model": OLLAMA_MODEL,
#         "messages": [{"role": "user", "content": prompt}],
#         "stream": False,
#     }
#     if OLLAMA_JSON_MODE:
#         chat_kwargs["format"] = "json"
#     if options:
#         chat_kwargs["options"] = options

#     response = client.chat(**chat_kwargs)
#     raw_output = response["message"]["content"]

#     if DEBUG_RAW_OUTPUT:
#         print("=" * 80, file=sys.stderr)
#         print("RAW LLM OUTPUT:", file=sys.stderr)
#         print(raw_output, file=sys.stderr)
#         print("=" * 80, file=sys.stderr)

#     return _extract_first_json(raw_output)


# # UPDATED: _as_bullets helper for feedback rendering
# def _as_bullets(value: Any) -> str:
#     if isinstance(value, list):
#         items = [str(item).strip() for item in value if str(item).strip()]
#     else:
#         items = [line.strip("- ").strip() for line in str(value).splitlines() if line.strip()]

#     if not items:
#         return "-"
#     return "\n".join(f"- {item}" for item in items)


# def _render_report(req: GradeRequest, structured: Dict[str, Any], warning: str = "") -> str:
#     intro_line = (
#         "This report includes an Overall Evaluation, highlights Strengths of the Submission, "
#         "identifies Areas That Need Improvement, offers Suggestions for Improvement, "
#         "and concludes with an Overall Comment."
#     )

#     criteria_lines = ["1. The rubric criteria"]
#     for crit in structured["rubric_criteria_feedback"]:
#         criteria_lines.append(f"- {crit['criterion']}: {crit['feedback']}")
#         criteria_lines.append("")

#     strengths = f"1) Overall strengths: {structured['overall_strengths']}"
#     weaknesses = f"2) Overall weaknesses: {structured['overall_weaknesses']}"

#     # checklist_lines = ["3. Presence of absence of checklist items."]
#     # for item in structured["checklist"]:
#     #     checklist_lines.append(f"- {item['item']}: {item['status']}")

#     warning_section = ""
#     if warning:
#         warning_section = f"\n[SYSTEM NOTE: {warning}]\n"

#     body = f"""{intro_line}

# {warning_section}
# Feedback criteria for all entries of the portfolio
# {chr(10).join(criteria_lines)}

# 2. Overall strength and weaknesses
# {strengths}
# {weaknesses}

# """
#     return body


# def _render_feedback(structured: Dict[str, Any]) -> str:
#     return f"""AI Learning Feedback Report

# 1. Overall Feedback
# {structured["overall_feedback"]}

# 2. Main Improvement Areas
# {_as_bullets(structured["main_improvement_areas"])}

# 3. Practical Suggestions
# {_as_bullets(structured["practical_suggestions"])}

# 4. Final Advice
# {structured["final_advice"]}
# """


# def _validate_report_text(report: str) -> None:
#     if not report.strip():
#         raise ValueError("Generated report is empty.")
#     required_sections = [
#         "Feedback criteria for all entries of the portfolio",
#         "1. The rubric criteria",
#         "2. Overall strength and weaknesses",
#         # "3. Presence of absence of checklist items.",
#     ]
#     missing = [section for section in required_sections if section not in report]
#     if missing:
#         raise ValueError(f"Generated report is missing sections: {', '.join(missing)}")


# def _validate_feedback_text(feedback: str) -> None:
#     if not feedback.strip():
#         raise ValueError("Generated feedback is empty.")
#     required_sections = [
#         "AI Learning Feedback Report",
#         "1. Overall Feedback",
#         "2. Main Improvement Areas",
#         "3. Practical Suggestions",
#         "4. Final Advice",
#     ]
#     missing = [section for section in required_sections if section not in feedback]
#     if missing:
#         raise ValueError(f"Generated feedback is missing sections: {', '.join(missing)}")
#     if _feedback_text_has_unsafe_content(feedback):
#         raise ValueError("Generated feedback contained restricted grading or rubric language.")


# # UPDATED: Old sanitizing function retained for feedback safety
# def _feedback_text_has_unsafe_content(text: str) -> Optional[str]:
#     text = text or ""
#     for pattern in UNSAFE_FEEDBACK_PATTERNS:
#         if re.search(pattern, text, flags=re.IGNORECASE):
#             return pattern
#     return None


# def _sanitize_feedback_text_value(value: Any, fallback: str) -> str:
#     text = str(value or "").replace("\r", "\n").strip()
#     if not text:
#         return fallback

#     safe_segments: List[str] = []
#     for raw_line in text.splitlines():
#         line = raw_line.strip(" -\t")
#         if not line:
#             continue
#         for segment in re.split(r"(?<=[.!?])\s+", line):
#             segment = segment.strip(" -\t")
#             if segment and not _feedback_text_has_unsafe_content(segment):
#                 safe_segments.append(segment)

#     clean = " ".join(safe_segments).strip()
#     return clean or fallback


# def _sanitize_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     sanitized: Dict[str, Any] = {}
#     for key in FEEDBACK_REQUIRED_KEYS:
#         fallback = FEEDBACK_SAFE_FALLBACKS[key]
#         value = obj.get(key)

#         if isinstance(value, list):
#             items = [
#                 _sanitize_feedback_text_value(item, "")
#                 for item in value
#             ]
#             sanitized[key] = [item for item in items if item] or [fallback]
#         else:
#             sanitized[key] = _sanitize_feedback_text_value(value, fallback)

#     return sanitized


# @app.get("/health")
# def health():
#     return {
#         "ok": True,
#         "ollama_base_url": OLLAMA_BASE_URL,
#         "ollama_model": OLLAMA_MODEL,
#     }


# @app.post("/grade", response_model=GradeResponse)
# def grade(req: GradeRequest):
#     raw_output_debug = ""
#     try:
#         max_input = MAX_INPUT_CHARS_FOR_SMALL_MODEL if "4b" in OLLAMA_MODEL.lower() or "3b" in OLLAMA_MODEL.lower() else MAX_EXTRACTED_CHARS
#         rubric_text = rubric_content(req, max_input)
#         submission_text = submission_content(req, max_input)

#         first_error = None
#         structured = None

#         for attempt in range(3):
#             try:
#                 enforce_no_repeat = (attempt >= 1)
#                 prompt = _build_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt > 0 and first_error else None,
#                     enforce_no_repeat=enforce_no_repeat,
#                 )
#                 raw_response = _call_ollama(prompt)
#                 raw_output_debug = json.dumps(raw_response, indent=2)
#                 structured = _validate_structured(raw_response)

#                 if structured["total_score"] == 0.0 and all(
#                     "No feedback" in crit["feedback"] for crit in structured["rubric_criteria_feedback"]
#                 ):
#                     raise ValueError("Model output appears to be default placeholders; retrying.")

#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 2:
#                     print("=" * 80, file=sys.stderr)
#                     print(f"GRADING FAILED after 3 attempts. Last raw LLM output:\n{raw_output_debug}", file=sys.stderr)
#                     print("=" * 80, file=sys.stderr)
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid grading output.")

#         warning = ""
#         if structured["total_score"] == 0.0 and all(
#             "No feedback" in crit["feedback"] for crit in structured["rubric_criteria_feedback"]
#         ):
#             warning = "The model's output was incomplete; some sections have been filled with defaults. Please review manually."

#         report = _render_report(req, structured, warning)
#         _validate_report_text(report)

#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="graded",
#             ai_grade=structured["total_score"],
#             ai_report_text=report,
#             ai_model=OLLAMA_MODEL,
#         )
#     except Exception as exc:
#         if raw_output_debug:
#             print("=" * 80, file=sys.stderr)
#             print(f"GRADING FAILED with error: {exc}\nRaw LLM output at failure:\n{raw_output_debug}", file=sys.stderr)
#             print("=" * 80, file=sys.stderr)
#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             ai_grade=None,
#             ai_report_text=None,
#             ai_model=OLLAMA_MODEL,
#             error=str(exc),
#         )


# # UPDATED: Feedback endpoint with retries, truncation, and debug logging
# @app.post("/feedback", response_model=FeedbackResponse)
# def feedback(req: GradeRequest):
#     raw_output_debug = ""
#     try:
#         max_input = MAX_INPUT_CHARS_FOR_SMALL_MODEL if "4b" in OLLAMA_MODEL.lower() or "3b" in OLLAMA_MODEL.lower() else MAX_EXTRACTED_CHARS
#         rubric_text = rubric_content(req, max_input)
#         submission_text = submission_content(req, max_input)

#         first_error = None
#         structured = None

#         for attempt in range(3):
#             try:
#                 enforce_no_repeat = (attempt >= 1)
#                 prompt = _build_feedback_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt > 0 and first_error else None,
#                     enforce_no_repeat=enforce_no_repeat,
#                 )
#                 raw_response = _call_ollama(prompt)
#                 raw_output_debug = json.dumps(raw_response, indent=2)
#                 structured = _validate_feedback_structured(raw_response)

#                 # Check if we got only defaults (likely failure)
#                 if (
#                     structured["overall_feedback"] == FEEDBACK_SAFE_FALLBACKS["overall_feedback"]
#                     and structured["main_improvement_areas"] == [FEEDBACK_SAFE_FALLBACKS["main_improvement_areas"]]
#                     and structured["practical_suggestions"] == [FEEDBACK_SAFE_FALLBACKS["practical_suggestions"]]
#                     and structured["final_advice"] == FEEDBACK_SAFE_FALLBACKS["final_advice"]
#                 ):
#                     raise ValueError("Model output appears to be default fallbacks; retrying.")

#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 2:
#                     print("=" * 80, file=sys.stderr)
#                     print(f"FEEDBACK FAILED after 3 attempts. Last raw LLM output:\n{raw_output_debug}", file=sys.stderr)
#                     print("=" * 80, file=sys.stderr)
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid feedback output.")

#         feedback_text = _render_feedback(structured)
#         _validate_feedback_text(feedback_text)

#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="completed",
#             feedback_text=feedback_text,
#             ai_model=OLLAMA_MODEL,
#         )
#     except Exception as exc:
#         if raw_output_debug:
#             print("=" * 80, file=sys.stderr)
#             print(f"FEEDBACK FAILED with error: {exc}\nRaw LLM output at failure:\n{raw_output_debug}", file=sys.stderr)
#             print("=" * 80, file=sys.stderr)
#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             feedback_text=None,
#             ai_model=OLLAMA_MODEL,
#             error=str(exc),
#         )



#above code is the correct general code this is for grade immediate 10 assignmnets send by dr rasitha
import json
import os
import re
import csv
import sys
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


def _env_float(name: str, default: float) -> float:
    raw_value = os.getenv(name, str(default))
    clean_value = raw_value.split("#", 1)[0].strip()
    try:
        return float(clean_value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a float value, got {raw_value!r}") from exc


def _env_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name, str(default)).strip().lower()
    return raw_value in ("1", "true", "yes", "on")


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", os.getenv("AIAGS_OLLAMA_MODEL", "llama3.1:8b"))

print(f"Using Ollama model: {OLLAMA_MODEL}")






OLLAMA_TIMEOUT_SECONDS = _env_int("OLLAMA_TIMEOUT_SECONDS", 120)
MAX_EXTRACTED_CHARS = _env_int("MAX_EXTRACTED_CHARS", 30000)
MAX_INPUT_CHARS_FOR_SMALL_MODEL = _env_int("MAX_INPUT_CHARS_FOR_SMALL_MODEL", 4000)   # UPDATED: shrink input for 4B models

# OLLAMA_JSON_MODE = _env_bool("OLLAMA_JSON_MODE", True)
OLLAMA_JSON_MODE = _env_bool("OLLAMA_JSON_MODE", True)  # UPDATED: Disable Ollama's JSON mode to avoid parsing issues
# OLLAMA_TEMPERATURE = _env_float("OLLAMA_TEMPERATURE", 0.3)
OLLAMA_TEMPERATURE = _env_float("OLLAMA_TEMPERATURE", 0.3)
OLLAMA_NUM_PREDICT = _env_int("OLLAMA_NUM_PREDICT", 4096)
DEBUG_RAW_OUTPUT = _env_bool("DEBUG_RAW_OUTPUT", False)


# Optionally, print the other settings for verification
print(f"MAX_EXTRACTED_CHARS = {MAX_EXTRACTED_CHARS}")
print(f"OLLAMA_JSON_MODE = {OLLAMA_JSON_MODE}")
print(f"MAX_INPUT_CHARS_FOR_SMALL_MODEL = {MAX_INPUT_CHARS_FOR_SMALL_MODEL}")
print(f"OLLAMA_TEMPERATURE = {OLLAMA_TEMPERATURE}")
print(f"OLLANMA_NUM_PREDICT = {OLLAMA_NUM_PREDICT}")

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
    "total_score",
    "rubric_criteria_feedback",
    "overall_strengths",
    "overall_weaknesses",
    # "checklist",
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


def _truncate(text: str, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[Content truncated for AI processing.]"


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


def submission_content(req: GradeRequest, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
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
    return _truncate(text, max_chars)


def rubric_content(req: GradeRequest, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
    parts = []
    if req.rubric.rubric_text and req.rubric.rubric_text.strip():
        parts.append(req.rubric.rubric_text.strip())
    if req.rubric.file_path:
        parts.append(extract_rubric_file_text(req.rubric.file_path))

    text = "\n\n".join(parts).strip()
    if not text:
        raise ValueError("Rubric content is missing or unreadable.")
    return _truncate(text, max_chars)


# UPDATED: Grading prompt with markers and no-repeat rule
def _build_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None, enforce_no_repeat: bool = False) -> str:
    correction_block = ""
    if correction:
        correction_block = f"""
The previous response was invalid for this reason:
{correction}

Return corrected JSON only inside the markers.
"""
    no_repeat = ""
    if enforce_no_repeat:
        no_repeat = "\nCRITICAL: DO NOT repeat any part of the submission or rubric. Your entire output must be ONLY the grading JSON inside the markers."

    return f"""
You are a medical education assessor with postgraduate qualifications. Grade the student portfolio using the rubric below.
Your entire response must be a single JSON object enclosed by the markers <<<GRADING_JSON_START>>> and <<<GRADING_JSON_END>>>.
{no_repeat}
RULES:
1. Read all entries in the submission before scoring.
2. Strictly adhere to the rubric criteria and weightage.
3. Score each criterion 1-4 (4=Excellent, 3=Good, 2=Satisfactory, 1=Needs Improvement).
4. Weighted Score = score × weightage. Sum to get total_score out of 100.
5. Score only what is textually present. Do not infer.
<<<GRADING_JSON_START>>>
{{
  "total_score": 0,
  "rubric_criteria_feedback": [
    {{"criterion": "Depth of reflection", "feedback": "..."}},
    {{"criterion": "Critical thinking and evaluative abilities", "feedback": "..."}},
    {{"criterion": "Creativity and Innovation", "feedback": "..."}},
    {{"criterion": "Content and Comprehensiveness", "feedback": "..."}},
    {{"criterion": "Structure, Presentation and Organization", "feedback": "..."}}
  ],
  "overall_strengths": "string",
  "overall_weaknesses": "string",
}}
<<<GRADING_JSON_END>>>

Rubric:
\"\"\"
{rubric_text}
\"\"\"

Student submission:
\"\"\"
{submission_text}
\"\"\"
{correction_block}
"""


# UPDATED: Feedback prompt with markers and no-repeat rule
def _build_feedback_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None, enforce_no_repeat: bool = False) -> str:
    correction_block = ""
    if correction:
        correction_block = f"""
The previous response was unsafe or invalid for this reason:
{correction}

Return corrected JSON only inside the markers.
"""
    no_repeat = ""
    if enforce_no_repeat:
        no_repeat = "\nCRITICAL: DO NOT repeat any part of the submission or rubric. Your entire output must be ONLY the feedback JSON inside the markers."

    return f"""
You are a helpful academic writing assistant giving private learning feedback to a student.
Use the assignment details, uploaded rubric, and student submission internally only.
Do not reveal the rubric, rubric criteria, hidden grading logic, marks, score, grade, awarded marks, or grading breakdown.
{no_repeat}

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

Return ONLY one valid JSON object enclosed by the markers <<<FEEDBACK_JSON_START>>> and <<<FEEDBACK_JSON_END>>> with this exact shape:
<<<FEEDBACK_JSON_START>>>
{{
  "overall_feedback": "Simple, helpful summary of the submission.",
  "main_improvement_areas": ["Area 1", "Area 2"],
  "practical_suggestions": ["Suggestion 1", "Suggestion 2"],
  "final_advice": "Encouraging final advice for improving before official evaluation."
}}
<<<FEEDBACK_JSON_END>>>

Rules:
- Do not mention score, grade, marks, points, percentages, rubric, criteria, awarded marks, or grading breakdown.
- Give only improvement advice.
- Write in simple, student-friendly language.
- Do not include markdown fences.
- Do not include text outside the markers.
{correction_block}
"""


# UPDATED: JSON extraction now handles both grading and feedback markers
def _extract_first_json(raw_output: str) -> Dict[str, Any]:
    raw_output = (raw_output or "").strip()
    if not raw_output:
        raise ValueError("Model returned empty output.")

    # Try grading markers
    if "GRADING_JSON_START" in raw_output and "GRADING_JSON_END" in raw_output:
        start_idx = raw_output.index("GRADING_JSON_START") + len("GRADING_JSON_START")
        end_idx = raw_output.index("GRADING_JSON_END")
        block = raw_output[start_idx:end_idx].strip()
        if block:
            raw_output = block

    # Try feedback markers
    if "FEEDBACK_JSON_START" in raw_output and "FEEDBACK_JSON_END" in raw_output:
        start_idx = raw_output.index("FEEDBACK_JSON_START") + len("FEEDBACK_JSON_START")
        end_idx = raw_output.index("FEEDBACK_JSON_END")
        block = raw_output[start_idx:end_idx].strip()
        if block:
            raw_output = block

    # Now parse
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


def _normalize_grading_json(obj: Dict[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}

    for key in ("total_score", "score", "final_score", "marks", "grade_points"):
        if key in obj:
            try:
                normalized["total_score"] = round(float(obj[key]), 2)
            except (ValueError, TypeError):
                pass
            break
    if "total_score" not in normalized:
        normalized["total_score"] = 0.0

    feedback = obj.get("rubric_criteria_feedback") or obj.get("criteria_feedback") or obj.get("rubric_feedback") or []
    if not isinstance(feedback, list):
        feedback = []
    normalized["rubric_criteria_feedback"] = feedback

    strengths = obj.get("overall_strengths") or obj.get("strengths") or obj.get("overall_strength") or ""
    normalized["overall_strengths"] = str(strengths) if strengths else "Not provided."

    weaknesses = obj.get("overall_weaknesses") or obj.get("weaknesses") or obj.get("overall_weakness") or ""
    normalized["overall_weaknesses"] = str(weaknesses) if weaknesses else "Not provided."

    # checklist = obj.get("checklist") or obj.get("checklist_items") or obj.get("presence_checklist") or []
    # if not isinstance(checklist, list):
    #     checklist = []
    # normalized["checklist"] = checklist

    return normalized


def _validate_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(obj, dict):
        raise ValueError("Model output is not an object.")

    obj = _normalize_grading_json(obj)

    score = obj.get("total_score")
    try:
        score = float(score)
    except (ValueError, TypeError):
        score = 0.0
    if score < 0 or score > 100:
        score = 0.0
    obj["total_score"] = round(score, 2)

    feedback_list = obj.get("rubric_criteria_feedback", [])
    if not isinstance(feedback_list, list):
        feedback_list = []
    cleaned_feedback = []
    for item in feedback_list:
        if isinstance(item, dict) and "criterion" in item and "feedback" in item:
            cleaned_feedback.append({
                "criterion": str(item["criterion"]).strip() or "Unnamed criterion",
                "feedback": str(item["feedback"]).strip() or "No feedback provided."
            })
        elif isinstance(item, dict) and "name" in item:
            cleaned_feedback.append({
                "criterion": str(item["name"]).strip(),
                "feedback": str(item.get("feedback", item.get("comment", ""))).strip() or "No feedback provided."
            })
    default_criteria = [
        "Depth of reflection",
        "Critical thinking and evaluative abilities",
        "Creativity and Innovation",
        "Content and Comprehensiveness",
        "Structure, Presentation and Organization"
    ]
    while len(cleaned_feedback) < 5:
        idx = len(cleaned_feedback)
        cleaned_feedback.append({
            "criterion": default_criteria[idx % len(default_criteria)],
            "feedback": "No feedback available from model."
        })
    obj["rubric_criteria_feedback"] = cleaned_feedback[:5]

    obj["overall_strengths"] = str(obj.get("overall_strengths", "")).strip() or "Not provided."
    obj["overall_weaknesses"] = str(obj.get("overall_weaknesses", "")).strip() or "Not provided."

    #commented because we dont want checklist 
    # checklist = obj.get("checklist", [])
    # if not isinstance(checklist, list):
    #     checklist = []
    # cleaned_checklist = []
    # for item in checklist:
    #     if isinstance(item, dict) and "item" in item and "status" in item:
    #         status = str(item["status"]).strip()
    #         if status.lower() not in ("present", "not present"):
    #             status = "Not Present"
    #         cleaned_checklist.append({
    #             "item": str(item["item"]).strip() or "Checklist item",
    #             "status": status
    #         })
    #     elif isinstance(item, dict) and "name" in item:
    #         cleaned_checklist.append({
    #             "item": str(item["name"]).strip(),
    #             "status": str(item.get("status", item.get("present", "Not Present"))).strip()
    #         })
    # # commented because we want to keep all checklist items, not just 5
    # # while len(cleaned_checklist) < 5:
    # #     cleaned_checklist.append({
    # #         "item": f"Checklist item {len(cleaned_checklist)+1}",
    # #         "status": "Not Present"
    # #     })
    # # obj["checklist"] = cleaned_checklist[:5]
       
    # # No padding or truncation – keep all items
    # obj["checklist"] = cleaned_checklist
    

    return obj


# UPDATED: Feedback validation now normalizes keys and falls back to defaults
def _validate_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(obj, dict):
        raise ValueError("Model output is not an object.")

    # Normalize alternative keys
    normalized = {}
    normalized["overall_feedback"] = str(obj.get("overall_feedback") or obj.get("summary") or obj.get("feedback") or "").strip()
    areas = obj.get("main_improvement_areas") or obj.get("improvement_areas") or obj.get("areas") or []
    if not isinstance(areas, list):
        areas = [str(areas)] if areas else []
    normalized["main_improvement_areas"] = [str(a).strip() for a in areas if str(a).strip()]

    suggestions = obj.get("practical_suggestions") or obj.get("suggestions") or obj.get("tips") or []
    if not isinstance(suggestions, list):
        suggestions = [str(suggestions)] if suggestions else []
    normalized["practical_suggestions"] = [str(s).strip() for s in suggestions if str(s).strip()]

    normalized["final_advice"] = str(obj.get("final_advice") or obj.get("conclusion") or obj.get("advice") or "").strip()

    # Fill empty with safe fallbacks
    if not normalized["overall_feedback"]:
        normalized["overall_feedback"] = FEEDBACK_SAFE_FALLBACKS["overall_feedback"]
    if not normalized["main_improvement_areas"]:
        normalized["main_improvement_areas"] = [FEEDBACK_SAFE_FALLBACKS["main_improvement_areas"]]
    if not normalized["practical_suggestions"]:
        normalized["practical_suggestions"] = [FEEDBACK_SAFE_FALLBACKS["practical_suggestions"]]
    if not normalized["final_advice"]:
        normalized["final_advice"] = FEEDBACK_SAFE_FALLBACKS["final_advice"]

    # Sanitize for restricted words
    return _sanitize_feedback_structured(normalized)


def _call_ollama(prompt: str) -> Dict[str, Any]:
    client = ollama.Client(host=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT_SECONDS)

    options = {}
    if OLLAMA_TEMPERATURE is not None:
        options["temperature"] = OLLAMA_TEMPERATURE
    if OLLAMA_NUM_PREDICT:
        options["num_predict"] = OLLAMA_NUM_PREDICT

    chat_kwargs = {
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    if OLLAMA_JSON_MODE:
        chat_kwargs["format"] = "json"
    if options:
        chat_kwargs["options"] = options

    response = client.chat(**chat_kwargs)
    raw_output = response["message"]["content"]

    if DEBUG_RAW_OUTPUT:
        print("=" * 80, file=sys.stderr)
        print("RAW LLM OUTPUT:", file=sys.stderr)
        print(raw_output, file=sys.stderr)
        print("=" * 80, file=sys.stderr)

    return _extract_first_json(raw_output)


# UPDATED: _as_bullets helper for feedback rendering
def _as_bullets(value: Any) -> str:
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
    else:
        items = [line.strip("- ").strip() for line in str(value).splitlines() if line.strip()]

    if not items:
        return "-"
    return "\n".join(f"- {item}" for item in items)


def _render_report(req: GradeRequest, structured: Dict[str, Any], warning: str = "") -> str:
    intro_line = (
        "This report includes an Overall Evaluation, highlights Strengths of the Submission, "
        "identifies Areas That Need Improvement, offers Suggestions for Improvement, "
        "and concludes with an Overall Comment."
    )

    criteria_lines = ["1. The rubric criteria"]
    for crit in structured["rubric_criteria_feedback"]:
        criteria_lines.append(f"- {crit['criterion']}: {crit['feedback']}")
        criteria_lines.append("")

    strengths = f"1) Overall strengths: {structured['overall_strengths']}"
    weaknesses = f"2) Overall weaknesses: {structured['overall_weaknesses']}"

    # checklist_lines = ["3. Presence of absence of checklist items."]
    # for item in structured["checklist"]:
    #     checklist_lines.append(f"- {item['item']}: {item['status']}")

    warning_section = ""
    if warning:
        warning_section = f"\n[SYSTEM NOTE: {warning}]\n"

    body = f"""{intro_line}

{warning_section}
Feedback criteria for all entries of the portfolio
{chr(10).join(criteria_lines)}

2. Overall strength and weaknesses
{strengths}
{weaknesses}

"""
    return body


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
        "Feedback criteria for all entries of the portfolio",
        "1. The rubric criteria",
        "2. Overall strength and weaknesses",
        # "3. Presence of absence of checklist items.",
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


# UPDATED: Old sanitizing function retained for feedback safety
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


@app.get("/health")
def health():
    return {
        "ok": True,
        "ollama_base_url": OLLAMA_BASE_URL,
        "ollama_model": OLLAMA_MODEL,
    }


@app.post("/grade", response_model=GradeResponse)
def grade(req: GradeRequest):
    raw_output_debug = ""
    try:
        max_input = MAX_INPUT_CHARS_FOR_SMALL_MODEL if "4b" in OLLAMA_MODEL.lower() or "3b" in OLLAMA_MODEL.lower() else MAX_EXTRACTED_CHARS
        rubric_text = rubric_content(req, max_input)
        submission_text = submission_content(req, max_input)

        first_error = None
        structured = None

        for attempt in range(3):
            try:
                enforce_no_repeat = (attempt >= 1)
                prompt = _build_prompt(
                    req,
                    rubric_text,
                    submission_text,
                    correction=str(first_error) if attempt > 0 and first_error else None,
                    enforce_no_repeat=enforce_no_repeat,
                )
                raw_response = _call_ollama(prompt)
                raw_output_debug = json.dumps(raw_response, indent=2)
                structured = _validate_structured(raw_response)

                if structured["total_score"] == 0.0 and all(
                    "No feedback" in crit["feedback"] for crit in structured["rubric_criteria_feedback"]
                ):
                    raise ValueError("Model output appears to be default placeholders; retrying.")

                break
            except Exception as exc:
                first_error = exc
                if attempt == 2:
                    print("=" * 80, file=sys.stderr)
                    print(f"GRADING FAILED after 3 attempts. Last raw LLM output:\n{raw_output_debug}", file=sys.stderr)
                    print("=" * 80, file=sys.stderr)
                    raise

        if structured is None:
            raise ValueError("LLM did not return valid grading output.")

        warning = ""
        if structured["total_score"] == 0.0 and all(
            "No feedback" in crit["feedback"] for crit in structured["rubric_criteria_feedback"]
        ):
            warning = "The model's output was incomplete; some sections have been filled with defaults. Please review manually."

        report = _render_report(req, structured, warning)
        _validate_report_text(report)

        return GradeResponse(
            portfolio_id=req.portfolio_id,
            status="graded",
            ai_grade=structured["total_score"],
            ai_report_text=report,
            ai_model=OLLAMA_MODEL,
        )
    except Exception as exc:
        if raw_output_debug:
            print("=" * 80, file=sys.stderr)
            print(f"GRADING FAILED with error: {exc}\nRaw LLM output at failure:\n{raw_output_debug}", file=sys.stderr)
            print("=" * 80, file=sys.stderr)
        return GradeResponse(
            portfolio_id=req.portfolio_id,
            status="failed",
            ai_grade=None,
            ai_report_text=None,
            ai_model=OLLAMA_MODEL,
            error=str(exc),
        )


# UPDATED: Feedback endpoint with retries, truncation, and debug logging
@app.post("/feedback", response_model=FeedbackResponse)
def feedback(req: GradeRequest):
    raw_output_debug = ""
    try:
        max_input = MAX_INPUT_CHARS_FOR_SMALL_MODEL if "4b" in OLLAMA_MODEL.lower() or "3b" in OLLAMA_MODEL.lower() else MAX_EXTRACTED_CHARS
        rubric_text = rubric_content(req, max_input)
        submission_text = submission_content(req, max_input)

        first_error = None
        structured = None

        for attempt in range(3):
            try:
                enforce_no_repeat = (attempt >= 1)
                prompt = _build_feedback_prompt(
                    req,
                    rubric_text,
                    submission_text,
                    correction=str(first_error) if attempt > 0 and first_error else None,
                    enforce_no_repeat=enforce_no_repeat,
                )
                raw_response = _call_ollama(prompt)
                raw_output_debug = json.dumps(raw_response, indent=2)
                structured = _validate_feedback_structured(raw_response)

                # Check if we got only defaults (likely failure)
                if (
                    structured["overall_feedback"] == FEEDBACK_SAFE_FALLBACKS["overall_feedback"]
                    and structured["main_improvement_areas"] == [FEEDBACK_SAFE_FALLBACKS["main_improvement_areas"]]
                    and structured["practical_suggestions"] == [FEEDBACK_SAFE_FALLBACKS["practical_suggestions"]]
                    and structured["final_advice"] == FEEDBACK_SAFE_FALLBACKS["final_advice"]
                ):
                    raise ValueError("Model output appears to be default fallbacks; retrying.")

                break
            except Exception as exc:
                first_error = exc
                if attempt == 2:
                    print("=" * 80, file=sys.stderr)
                    print(f"FEEDBACK FAILED after 3 attempts. Last raw LLM output:\n{raw_output_debug}", file=sys.stderr)
                    print("=" * 80, file=sys.stderr)
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
        if raw_output_debug:
            print("=" * 80, file=sys.stderr)
            print(f"FEEDBACK FAILED with error: {exc}\nRaw LLM output at failure:\n{raw_output_debug}", file=sys.stderr)
            print("=" * 80, file=sys.stderr)
        return FeedbackResponse(
            portfolio_id=req.portfolio_id,
            status="failed",
            feedback_text=None,
            ai_model=OLLAMA_MODEL,
            error=str(exc),
        )




# #this is testing using gemini api keys
# # ============================================================
# # app.py - AI Grading Service with Ollama + Gemini 3.5 Flash
# # ============================================================
# import json
# import os
# import re
# import csv
# import sys
# from datetime import datetime
# from pathlib import Path
# from typing import Any, Dict, List, Optional, Set

# from dotenv import load_dotenv
# from fastapi import FastAPI
# from pydantic import BaseModel

# import ollama

# load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

# app = FastAPI(title="AIAGS ML Service", version="3.0")

# # ---------- Environment helpers ----------
# def _env_int(name: str, default: int) -> int:
#     raw_value = os.getenv(name, str(default))
#     clean_value = raw_value.split("#", 1)[0].strip()
#     try:
#         return int(clean_value)
#     except ValueError as exc:
#         raise ValueError(f"{name} must be an integer value, got {raw_value!r}") from exc

# def _env_float(name: str, default: float) -> float:
#     raw_value = os.getenv(name, str(default))
#     clean_value = raw_value.split("#", 1)[0].strip()
#     try:
#         return float(clean_value)
#     except ValueError as exc:
#         raise ValueError(f"{name} must be a float value, got {raw_value!r}") from exc

# def _env_bool(name: str, default: bool) -> bool:
#     raw_value = os.getenv(name, str(default)).strip().lower()
#     return raw_value in ("1", "true", "yes", "on")

# # ---------- Ollama Configuration ----------
# OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
# OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", os.getenv("AIAGS_OLLAMA_MODEL", "llama3.1:8b"))
# OLLAMA_TIMEOUT_SECONDS = _env_int("OLLAMA_TIMEOUT_SECONDS", 120)
# MAX_EXTRACTED_CHARS = _env_int("MAX_EXTRACTED_CHARS", 30000)
# MAX_INPUT_CHARS_FOR_SMALL_MODEL = _env_int("MAX_INPUT_CHARS_FOR_SMALL_MODEL", 4000)
# OLLAMA_JSON_MODE = _env_bool("OLLAMA_JSON_MODE", True)
# # OLLAMA_TEMPERATURE = _env_float("OLLAMA_TEMPERATURE", 0.3)
# OLLAMA_TEMPERATURE = _env_float("OLLAMA_TEMPERATURE", 0.0)

# OLLAMA_NUM_PREDICT = _env_int("OLLAMA_NUM_PREDICT", 4096)
# DEBUG_RAW_OUTPUT = _env_bool("DEBUG_RAW_OUTPUT", False)

# # ---------- NEW: AI Provider Configuration ----------
# AI_PROVIDER = os.getenv("AI_PROVIDER", "ollama").lower()   # "ollama" or "gemini"
# GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")  # Use gemini-2.0-flash or gemini-1.5-flash
# ACTIVE_MODEL = OLLAMA_MODEL if AI_PROVIDER == "ollama" else GEMINI_MODEL

# print(f"Using AI provider: {AI_PROVIDER}, Active model: {ACTIVE_MODEL}")

# # ---------- Other constants (unchanged) ----------
# RUBRIC_EXTENSIONS = {".xlsx", ".xls", ".csv", ".pdf", ".docx"}
# SUBMISSION_EXTENSIONS = {".pdf", ".docx"}
# UNSUPPORTED_FILE_MESSAGE = (
#     "Unsupported file type. Please upload rubric as Excel/PDF/DOCX and assignment submission as PDF or DOCX."
# )
# DOC_UNSUPPORTED_MESSAGE = "DOC files are not supported. Please convert the document to DOCX or PDF and upload again."
# PDF_TEXT_UNREADABLE_MESSAGE = (
#     "PDF text could not be extracted. The file may be scanned or image-based. "
#     "Please upload a text-based PDF or DOCX."
# )

# # ---------- Pydantic Models (unchanged) ----------
# class AssignmentInfo(BaseModel):
#     assignment_id: int
#     assignment_name: str
#     course_name: Optional[str] = None
#     batch: Optional[str] = None
#     department: Optional[str] = None
#     start_date: Optional[str] = None
#     deadline_date: Optional[str] = None
#     remark: Optional[str] = None

# class StudentInfo(BaseModel):
#     student_no: str

# class RubricInfo(BaseModel):
#     rubric_id: int
#     rubric_name: Optional[str] = None
#     rubric_text: Optional[str] = None
#     file_path: Optional[str] = None
#     file_mime: Optional[str] = None
#     file_original_name: Optional[str] = None

# class SubmissionFileInfo(BaseModel):
#     file_id: Optional[int] = None
#     file_path: str
#     file_original_name: Optional[str] = None
#     file_mime: Optional[str] = None
#     required_document_name: Optional[str] = None

# class SubmissionInfo(BaseModel):
#     portfolio_id: int
#     file_path: str
#     portfolio_link: Optional[str] = None
#     uploaded_at: Optional[str] = None
#     files: Optional[List[SubmissionFileInfo]] = None

# class GradeRequest(BaseModel):
#     portfolio_id: int
#     assignment: AssignmentInfo
#     student: StudentInfo
#     rubric: RubricInfo
#     submission: SubmissionInfo

# class GradeResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     ai_grade: Optional[float] = None
#     ai_report_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None

# class FeedbackResponse(BaseModel):
#     portfolio_id: int
#     status: str
#     feedback_text: Optional[str] = None
#     ai_model: str
#     error: Optional[str] = None

# # ---------- Feedback safety constants (unchanged) ----------
# REQUIRED_KEYS = [
#     "total_score",
#     "rubric_criteria_feedback",
#     "overall_strengths",
#     "overall_weaknesses",
# ]

# FEEDBACK_REQUIRED_KEYS = [
#     "overall_feedback",
#     "main_improvement_areas",
#     "practical_suggestions",
#     "final_advice",
# ]

# UNSAFE_FEEDBACK_PATTERNS = [
#     r"\bscore\b",
#     r"\bgrade\b",
#     r"\bmarks?\b",
#     r"\bpoints?\b",
#     r"\brubric\b",
#     r"\bcriteria?\b",
#     r"\bcriterion\b",
#     r"\bawarded\b",
#     r"\bgrading\b",
#     r"\b\d{1,3}\s*(/|out of)\s*100\b",
#     r"\b\d{1,3}\s*%\b",
# ]

# FEEDBACK_SAFE_FALLBACKS = {
#     "overall_feedback": "Your submission has been reviewed for learning support. Focus on making your explanation clearer, more complete, and easier to follow.",
#     "main_improvement_areas": "Improve clarity, organization, evidence, and completeness in the main sections of your work.",
#     "practical_suggestions": "Review each section, add clearer explanations, support important statements, and check formatting before submitting again.",
#     "final_advice": "Revise your work carefully and use this feedback to strengthen your submission before official evaluation.",
# }

# # ---------- Existing Text Extraction Functions (unchanged) ----------
# def _truncate(text: str, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     text = (text or "").strip()
#     if len(text) <= max_chars:
#         return text
#     return text[:max_chars] + "\n\n[Content truncated for AI processing.]"

# def _format_table(title: str, rows: List[List[Any]]) -> str:
#     cleaned_rows: List[List[str]] = []
#     for row in rows:
#         cleaned = [str(cell).strip() if cell is not None else "" for cell in row]
#         if any(cleaned):
#             cleaned_rows.append(cleaned)
#     if not cleaned_rows:
#         return ""
#     max_cols = max(len(row) for row in cleaned_rows)
#     lines = [title]
#     for idx, row in enumerate(cleaned_rows, start=1):
#         normalized = row + [""] * (max_cols - len(row))
#         lines.append(f"Row {idx}: " + " | ".join(normalized))
#     return "\n".join(lines)

# def _extract_pdf_text(file_path: str) -> str:
#     text_parts: List[str] = []
#     try:
#         import pdfplumber
#         with pdfplumber.open(file_path) as pdf:
#             for page in pdf.pages:
#                 page_text = page.extract_text() or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#     except Exception:
#         text_parts = []
#     if not text_parts:
#         try:
#             import fitz
#             doc = fitz.open(file_path)
#             for page in doc:
#                 page_text = page.get_text("text") or ""
#                 if page_text.strip():
#                     text_parts.append(page_text.strip())
#         except Exception:
#             text_parts = []
#     text = "\n".join(text_parts).strip()
#     if not text:
#         raise ValueError(PDF_TEXT_UNREADABLE_MESSAGE)
#     return _truncate(text)

# def _extract_docx_text(file_path: str) -> str:
#     try:
#         from docx import Document
#         doc = Document(file_path)
#         text_parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
#         for table_index, table in enumerate(doc.tables, start=1):
#             rows = []
#             for row in table.rows:
#                 rows.append([cell.text.replace("\n", " ").strip() for cell in row.cells])
#             table_text = _format_table(f"TABLE {table_index}:", rows)
#             if table_text:
#                 text_parts.append(table_text)
#         text = "\n".join(text_parts).strip()
#     except Exception as exc:
#         raise ValueError("Could not read DOCX content.") from exc
#     if not text:
#         raise ValueError("No readable text found in DOCX file.")
#     return _truncate(text)

# def _extract_xlsx_text(file_path: str) -> str:
#     try:
#         from openpyxl import load_workbook
#         workbook = load_workbook(file_path, read_only=True, data_only=True)
#         parts = []
#         for sheet in workbook.worksheets:
#             rows = [[cell for cell in row] for row in sheet.iter_rows(values_only=True)]
#             table_text = _format_table(f"SHEET: {sheet.title}", rows)
#             if table_text:
#                 parts.append(table_text)
#         workbook.close()
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc
#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)

# def _extract_xls_text(file_path: str) -> str:
#     try:
#         import pandas as pd
#         sheets = pd.read_excel(file_path, sheet_name=None, header=None, dtype=str, engine="xlrd")
#         parts = []
#         for sheet_name, frame in sheets.items():
#             frame = frame.dropna(how="all").dropna(axis=1, how="all")
#             rows = frame.where(pd.notna(frame), None).values.tolist()
#             table_text = _format_table(f"SHEET: {sheet_name}", rows)
#             if table_text:
#                 parts.append(table_text)
#     except Exception as exc:
#         raise ValueError("Could not read Excel rubric content.") from exc
#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("No readable text found in Excel rubric.")
#     return _truncate(text)

# def _extract_csv_text(file_path: str) -> str:
#     last_error: Optional[Exception] = None
#     for encoding in ("utf-8-sig", "utf-8", "latin-1"):
#         try:
#             with open(file_path, newline="", encoding=encoding) as f:
#                 rows = list(csv.reader(f))
#             text = _format_table("CSV RUBRIC:", rows).strip()
#             if not text:
#                 raise ValueError("No readable text found in CSV rubric.")
#             return _truncate(text)
#         except Exception as exc:
#             last_error = exc
#     raise ValueError("Could not read CSV rubric content.") from last_error

# def extract_text(file_path: Optional[str], label: str, allowed_extensions: Set[str]) -> str:
#     if not file_path:
#         raise ValueError(f"{label} file path is missing.")
#     if not os.path.exists(file_path):
#         raise ValueError(f"{label} file was not found.")
#     ext = os.path.splitext(file_path)[1].lower()
#     if ext == ".doc":
#         raise ValueError(DOC_UNSUPPORTED_MESSAGE)
#     if ext not in allowed_extensions:
#         raise ValueError(UNSUPPORTED_FILE_MESSAGE)
#     if ext == ".pdf":
#         return _extract_pdf_text(file_path)
#     if ext == ".docx":
#         return _extract_docx_text(file_path)
#     if ext == ".xlsx":
#         return _extract_xlsx_text(file_path)
#     if ext == ".xls":
#         return _extract_xls_text(file_path)
#     if ext == ".csv":
#         return _extract_csv_text(file_path)
#     raise ValueError(UNSUPPORTED_FILE_MESSAGE)

# def extract_rubric_file_text(file_path: str) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "rubric", RUBRIC_EXTENSIONS)
#     return f"RUBRIC FILE: {filename}\n{content}"

# def extract_submission_file_text(file_path: str, index: int = 1) -> str:
#     filename = os.path.basename(file_path)
#     content = extract_text(file_path, "student submission", SUBMISSION_EXTENSIONS)
#     return f"FILE {index}: {filename}\n{content}"

# def submission_content(req: GradeRequest, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     parts: List[str] = []
#     seen_paths: Set[str] = set()
#     files = req.submission.files or []
#     for index, file_info in enumerate(files, start=1):
#         if not file_info.file_path or file_info.file_path in seen_paths:
#             continue
#         seen_paths.add(file_info.file_path)
#         heading = extract_submission_file_text(file_info.file_path, index)
#         if file_info.required_document_name:
#             heading = f"REQUIRED DOCUMENT: {file_info.required_document_name}\n{heading}"
#         parts.append(heading)
#     if not parts and req.submission.file_path:
#         parts.append(extract_submission_file_text(req.submission.file_path))
#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Student submission content is missing or unreadable.")
#     return _truncate(text, max_chars)

# def rubric_content(req: GradeRequest, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
#     parts = []
#     if req.rubric.rubric_text and req.rubric.rubric_text.strip():
#         parts.append(req.rubric.rubric_text.strip())
#     if req.rubric.file_path:
#         parts.append(extract_rubric_file_text(req.rubric.file_path))
#     text = "\n\n".join(parts).strip()
#     if not text:
#         raise ValueError("Rubric content is missing or unreadable.")
#     return _truncate(text, max_chars)

# # ---------- Prompt Builders (unchanged) ----------
# def _build_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None, enforce_no_repeat: bool = False) -> str:
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was invalid for this reason:
# {correction}

# Return corrected JSON only inside the markers.
# """
#     no_repeat = ""
#     if enforce_no_repeat:
#         no_repeat = "\nCRITICAL: DO NOT repeat any part of the submission or rubric. Your entire output must be ONLY the grading JSON inside the markers."
#     return f"""
# You are a medical education assessor with postgraduate qualifications. Grade the student portfolio using the rubric below.
# Your entire response must be a single JSON object enclosed by the markers <<<GRADING_JSON_START>>> and <<<GRADING_JSON_END>>>.
# {no_repeat}
# RULES:
# 1. Read all entries in the submission before scoring.
# 2. Strictly adhere to the rubric criteria and weightage.
# 3. Score each criterion 1-4 (4=Excellent, 3=Good, 2=Satisfactory, 1=Needs Improvement).
# 4. Weighted Score = score × weightage. Sum to get total_score out of 100.
# 5. Score only what is textually present. Do not infer.
# <<<GRADING_JSON_START>>>
# {{
#   "total_score": 0,
#   "rubric_criteria_feedback": [
#     {{"criterion": "Depth of reflection", "feedback": "..."}},
#     {{"criterion": "Critical thinking and evaluative abilities", "feedback": "..."}},
#     {{"criterion": "Creativity and Innovation", "feedback": "..."}},
#     {{"criterion": "Content and Comprehensiveness", "feedback": "..."}},
#     {{"criterion": "Structure, Presentation and Organization", "feedback": "..."}}
#   ],
#   "overall_strengths": "string",
#   "overall_weaknesses": "string",
# }}
# <<<GRADING_JSON_END>>>

# Rubric:
# \"\"\"
# {rubric_text}
# \"\"\"

# Student submission:
# \"\"\"
# {submission_text}
# \"\"\"
# {correction_block}
# """

# def _build_feedback_prompt(req: GradeRequest, rubric_text: str, submission_text: str, correction: Optional[str] = None, enforce_no_repeat: bool = False) -> str:
#     correction_block = ""
#     if correction:
#         correction_block = f"""
# The previous response was unsafe or invalid for this reason:
# {correction}

# Return corrected JSON only inside the markers.
# """
#     no_repeat = ""
#     if enforce_no_repeat:
#         no_repeat = "\nCRITICAL: DO NOT repeat any part of the submission or rubric. Your entire output must be ONLY the feedback JSON inside the markers."
#     return f"""
# You are a helpful academic writing assistant giving private learning feedback to a student.
# Use the assignment details, uploaded rubric, and student submission internally only.
# Do not reveal the rubric, rubric criteria, hidden grading logic, marks, score, grade, awarded marks, or grading breakdown.
# {no_repeat}

# Assignment:
# - Name: {req.assignment.assignment_name}
# - Course: {req.assignment.course_name or "Not specified"}
# - Batch: {req.assignment.batch or "Not specified"}
# - Department: {req.assignment.department or "Not specified"}

# Student submission content:
# \"\"\"
# {submission_text}
# \"\"\"

# Internal rubric content. Use it only to guide improvement advice. Do not mention or quote it:
# \"\"\"
# {rubric_text}
# \"\"\"

# Return ONLY one valid JSON object enclosed by the markers <<<FEEDBACK_JSON_START>>> and <<<FEEDBACK_JSON_END>>> with this exact shape:
# <<<FEEDBACK_JSON_START>>>
# {{
#   "overall_feedback": "Simple, helpful summary of the submission.",
#   "main_improvement_areas": ["Area 1", "Area 2"],
#   "practical_suggestions": ["Suggestion 1", "Suggestion 2"],
#   "final_advice": "Encouraging final advice for improving before official evaluation."
# }}
# <<<FEEDBACK_JSON_END>>>

# Rules:
# - Do not mention score, grade, marks, points, percentages, rubric, criteria, awarded marks, or grading breakdown.
# - Give only improvement advice.
# - Write in simple, student-friendly language.
# - Do not include markdown fences.
# - Do not include text outside the markers.
# {correction_block}
# """

# # ---------- JSON Extraction & Validation (unchanged) ----------
# def _extract_first_json(raw_output: str) -> Dict[str, Any]:
#     raw_output = (raw_output or "").strip()
#     if not raw_output:
#         raise ValueError("Model returned empty output.")
#     if "GRADING_JSON_START" in raw_output and "GRADING_JSON_END" in raw_output:
#         start_idx = raw_output.index("GRADING_JSON_START") + len("GRADING_JSON_START")
#         end_idx = raw_output.index("GRADING_JSON_END")
#         block = raw_output[start_idx:end_idx].strip()
#         if block:
#             raw_output = block
#     if "FEEDBACK_JSON_START" in raw_output and "FEEDBACK_JSON_END" in raw_output:
#         start_idx = raw_output.index("FEEDBACK_JSON_START") + len("FEEDBACK_JSON_START")
#         end_idx = raw_output.index("FEEDBACK_JSON_END")
#         block = raw_output[start_idx:end_idx].strip()
#         if block:
#             raw_output = block
#     if "```" in raw_output:
#         parts = raw_output.split("```")
#         candidates = [p for p in parts if "{" in p]
#         if candidates:
#             raw_output = candidates[0].strip()
#             if raw_output.lower().startswith("json"):
#                 raw_output = raw_output[4:].strip()
#     try:
#         return json.loads(raw_output)
#     except json.JSONDecodeError:
#         pass
#     decoder = json.JSONDecoder()
#     for i, ch in enumerate(raw_output):
#         if ch == "{":
#             try:
#                 obj, _ = decoder.raw_decode(raw_output[i:])
#                 return obj
#             except json.JSONDecodeError:
#                 continue
#     raise ValueError("Model did not return a valid JSON object.")

# def _normalize_grading_json(obj: Dict[str, Any]) -> Dict[str, Any]:
#     normalized: Dict[str, Any] = {}
#     for key in ("total_score", "score", "final_score", "marks", "grade_points"):
#         if key in obj:
#             try:
#                 normalized["total_score"] = round(float(obj[key]), 2)
#             except (ValueError, TypeError):
#                 pass
#             break
#     if "total_score" not in normalized:
#         normalized["total_score"] = 0.0
#     feedback = obj.get("rubric_criteria_feedback") or obj.get("criteria_feedback") or obj.get("rubric_feedback") or []
#     if not isinstance(feedback, list):
#         feedback = []
#     normalized["rubric_criteria_feedback"] = feedback
#     strengths = obj.get("overall_strengths") or obj.get("strengths") or obj.get("overall_strength") or ""
#     normalized["overall_strengths"] = str(strengths) if strengths else "Not provided."
#     weaknesses = obj.get("overall_weaknesses") or obj.get("weaknesses") or obj.get("overall_weakness") or ""
#     normalized["overall_weaknesses"] = str(weaknesses) if weaknesses else "Not provided."
#     return normalized

# def _validate_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")
#     obj = _normalize_grading_json(obj)
#     score = obj.get("total_score")
#     try:
#         score = float(score)
#     except (ValueError, TypeError):
#         score = 0.0
#     if score < 0 or score > 100:
#         score = 0.0
#     obj["total_score"] = round(score, 2)
#     feedback_list = obj.get("rubric_criteria_feedback", [])
#     if not isinstance(feedback_list, list):
#         feedback_list = []
#     cleaned_feedback = []
#     for item in feedback_list:
#         if isinstance(item, dict) and "criterion" in item and "feedback" in item:
#             cleaned_feedback.append({
#                 "criterion": str(item["criterion"]).strip() or "Unnamed criterion",
#                 "feedback": str(item["feedback"]).strip() or "No feedback provided."
#             })
#         elif isinstance(item, dict) and "name" in item:
#             cleaned_feedback.append({
#                 "criterion": str(item["name"]).strip(),
#                 "feedback": str(item.get("feedback", item.get("comment", ""))).strip() or "No feedback provided."
#             })
#     default_criteria = [
#         "Depth of reflection",
#         "Critical thinking and evaluative abilities",
#         "Creativity and Innovation",
#         "Content and Comprehensiveness",
#         "Structure, Presentation and Organization"
#     ]
#     while len(cleaned_feedback) < 5:
#         idx = len(cleaned_feedback)
#         cleaned_feedback.append({
#             "criterion": default_criteria[idx % len(default_criteria)],
#             "feedback": "No feedback available from model."
#         })
#     obj["rubric_criteria_feedback"] = cleaned_feedback[:5]
#     obj["overall_strengths"] = str(obj.get("overall_strengths", "")).strip() or "Not provided."
#     obj["overall_weaknesses"] = str(obj.get("overall_weaknesses", "")).strip() or "Not provided."
#     return obj

# def _validate_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(obj, dict):
#         raise ValueError("Model output is not an object.")
#     normalized = {}
#     normalized["overall_feedback"] = str(obj.get("overall_feedback") or obj.get("summary") or obj.get("feedback") or "").strip()
#     areas = obj.get("main_improvement_areas") or obj.get("improvement_areas") or obj.get("areas") or []
#     if not isinstance(areas, list):
#         areas = [str(areas)] if areas else []
#     normalized["main_improvement_areas"] = [str(a).strip() for a in areas if str(a).strip()]
#     suggestions = obj.get("practical_suggestions") or obj.get("suggestions") or obj.get("tips") or []
#     if not isinstance(suggestions, list):
#         suggestions = [str(suggestions)] if suggestions else []
#     normalized["practical_suggestions"] = [str(s).strip() for s in suggestions if str(s).strip()]
#     normalized["final_advice"] = str(obj.get("final_advice") or obj.get("conclusion") or obj.get("advice") or "").strip()
#     if not normalized["overall_feedback"]:
#         normalized["overall_feedback"] = FEEDBACK_SAFE_FALLBACKS["overall_feedback"]
#     if not normalized["main_improvement_areas"]:
#         normalized["main_improvement_areas"] = [FEEDBACK_SAFE_FALLBACKS["main_improvement_areas"]]
#     if not normalized["practical_suggestions"]:
#         normalized["practical_suggestions"] = [FEEDBACK_SAFE_FALLBACKS["practical_suggestions"]]
#     if not normalized["final_advice"]:
#         normalized["final_advice"] = FEEDBACK_SAFE_FALLBACKS["final_advice"]
#     return _sanitize_feedback_structured(normalized)

# # ---------- Sanitization (unchanged) ----------
# def _feedback_text_has_unsafe_content(text: str) -> Optional[str]:
#     text = text or ""
#     for pattern in UNSAFE_FEEDBACK_PATTERNS:
#         if re.search(pattern, text, flags=re.IGNORECASE):
#             return pattern
#     return None

# def _sanitize_feedback_text_value(value: Any, fallback: str) -> str:
#     text = str(value or "").replace("\r", "\n").strip()
#     if not text:
#         return fallback
#     safe_segments: List[str] = []
#     for raw_line in text.splitlines():
#         line = raw_line.strip(" -\t")
#         if not line:
#             continue
#         for segment in re.split(r"(?<=[.!?])\s+", line):
#             segment = segment.strip(" -\t")
#             if segment and not _feedback_text_has_unsafe_content(segment):
#                 safe_segments.append(segment)
#     clean = " ".join(safe_segments).strip()
#     return clean or fallback

# def _sanitize_feedback_structured(obj: Dict[str, Any]) -> Dict[str, Any]:
#     sanitized: Dict[str, Any] = {}
#     for key in FEEDBACK_REQUIRED_KEYS:
#         fallback = FEEDBACK_SAFE_FALLBACKS[key]
#         value = obj.get(key)
#         if isinstance(value, list):
#             items = [_sanitize_feedback_text_value(item, "") for item in value]
#             sanitized[key] = [item for item in items if item] or [fallback]
#         else:
#             sanitized[key] = _sanitize_feedback_text_value(value, fallback)
#     return sanitized

# # ---------- Ollama Caller (unchanged) ----------
# def _call_ollama(prompt: str) -> Dict[str, Any]:
#     client = ollama.Client(host=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT_SECONDS)
#     options = {}
#     if OLLAMA_TEMPERATURE is not None:
#         options["temperature"] = OLLAMA_TEMPERATURE
#     if OLLAMA_NUM_PREDICT:
#         options["num_predict"] = OLLAMA_NUM_PREDICT
#     chat_kwargs = {
#         "model": OLLAMA_MODEL,
#         "messages": [{"role": "user", "content": prompt}],
#         "stream": False,
#     }
#     if OLLAMA_JSON_MODE:
#         chat_kwargs["format"] = "json"
#     if options:
#         chat_kwargs["options"] = options
#     response = client.chat(**chat_kwargs)
#     raw_output = response["message"]["content"]
#     if DEBUG_RAW_OUTPUT:
#         print("=" * 80, file=sys.stderr)
#         print("RAW OLLAMA OUTPUT:", file=sys.stderr)
#         print(raw_output, file=sys.stderr)
#         print("=" * 80, file=sys.stderr)
#     return _extract_first_json(raw_output)

# # # ---------- NEW: Google Gemini Vision Caller ----------
# # def _call_gemini_vision(prompt: str, file_paths: List[str]) -> Dict[str, Any]:
# #     """Send prompt + files to Gemini for visual understanding."""
# #     if not GEMINI_API_KEY:
# #         raise ValueError("GEMINI_API_KEY is not set")
# #     try:
# #         # import google.generativeai as genai
# #         from google import genai
# #         from google.genai import types
# #     except ImportError:
# #         raise RuntimeError("google-generativeai not installed. Run: pip install google-generativeai")
    
# #     genai.configure(api_key=GEMINI_API_KEY)
# #     model = genai.GenerativeModel(GEMINI_MODEL)
    
# #     # Upload files
# #     uploaded_files = []
# #     for path in file_paths:
# #         if os.path.exists(path):
# #             try:
# #                 uploaded = genai.upload_file(path, display_name=os.path.basename(path))
# #                 uploaded_files.append(uploaded)
# #             except Exception as e:
# #                 print(f"Warning: Failed to upload {path}: {e}", file=sys.stderr)
    
# #     # Build contents: prompt text + uploaded files
# #     contents = [prompt] + uploaded_files
    
# #     generation_config = {
# #         "response_mime_type": "application/json",
# #         "temperature": OLLAMA_TEMPERATURE,
# #         "max_output_tokens": OLLAMA_NUM_PREDICT,
# #     }
    
# #     try:
# #         response = model.generate_content(contents, generation_config=generation_config)
# #         raw_output = response.text
# #         if DEBUG_RAW_OUTPUT:
# #             print("=" * 80, file=sys.stderr)
# #             print("RAW GEMINI OUTPUT:", file=sys.stderr)
# #             print(raw_output, file=sys.stderr)
# #             print("=" * 80, file=sys.stderr)
# #         return _extract_first_json(raw_output)
# #     except Exception as e:
# #         raise RuntimeError(f"Gemini API error: {e}")


# def _call_gemini_vision(prompt: str, file_paths: List[str]) -> Dict[str, Any]:
#     """Send prompt + PDF/DOCX files to Gemini using the current Google GenAI SDK."""

#     if not GEMINI_API_KEY:
#         raise ValueError("GEMINI_API_KEY is not set")

#     try:
#         from google import genai
#         from google.genai import types
#     except ImportError:
#         raise RuntimeError(
#             "google-genai is not installed. Run: pip install -U google-genai"
#         )

#     try:
#         # Create Gemini client
#         client = genai.Client(api_key=GEMINI_API_KEY)

#         uploaded_files = []

#         # Upload all files
#         for path in file_paths:

#             if not path or not os.path.exists(path):
#                 print(
#                     f"Warning: File does not exist: {path}",
#                     file=sys.stderr
#                 )
#                 continue

#             try:
#                 print(
#                     f"Uploading file to Gemini: {path}",
#                     file=sys.stderr
#                 )

#                 uploaded_file = client.files.upload(
#                     file=path
#                 )

#                 print(
#                     f"Gemini upload successful: {uploaded_file.name}",
#                     file=sys.stderr
#                 )

#                 uploaded_files.append(uploaded_file)

#             except Exception as e:
#                 raise RuntimeError(
#                     f"Failed to upload file to Gemini: {path}\n"
#                     f"Error: {e}"
#                 ) from e

#         if not uploaded_files:
#             raise RuntimeError(
#                 "No files were successfully uploaded to Gemini."
#             )

#         # Build Gemini contents
#         contents = [prompt]

#         for uploaded_file in uploaded_files:
#             contents.append(uploaded_file)

#         # Gemini generation configuration
#         generation_config = types.GenerateContentConfig(
#             response_mime_type="application/json",
#             temperature=OLLAMA_TEMPERATURE,
#             max_output_tokens=OLLAMA_NUM_PREDICT,
#         )

#         print(
#             f"Sending request to Gemini model: {GEMINI_MODEL}",
#             file=sys.stderr
#         )

#         response = client.models.generate_content(
#             model=GEMINI_MODEL,
#             contents=contents,
#             config=generation_config,
#         )

#         raw_output = response.text

#         if not raw_output:
#             raise RuntimeError(
#                 "Gemini returned an empty response."
#             )

#         if DEBUG_RAW_OUTPUT:
#             print("=" * 80, file=sys.stderr)
#             print("RAW GEMINI OUTPUT:", file=sys.stderr)
#             print(raw_output, file=sys.stderr)
#             print("=" * 80, file=sys.stderr)

#         return _extract_first_json(raw_output)

#     except Exception as e:
#         raise RuntimeError(
#             f"Gemini API error: {e}"
#         ) from e

# # ---------- NEW: Unified AI Caller (with fallback) ----------
# def _call_ai(prompt: str, file_paths: Optional[List[str]] = None) -> Dict[str, Any]:
#     """Route to the selected AI provider, falling back to Ollama on failure."""
#     try:
#         if AI_PROVIDER == "gemini" and file_paths:
#             # Use vision if files are provided
#             return _call_gemini_vision(prompt, file_paths)
#         elif AI_PROVIDER == "gemini":
#             # If no files, fallback to Ollama (Gemini can't read empty)
#             print("No files provided for Gemini; falling back to Ollama.", file=sys.stderr)
#             return _call_ollama(prompt)
#         else:
#             return _call_ollama(prompt)
#     except Exception as e:
#         print(f"AI provider '{AI_PROVIDER}' failed: {e}. Falling back to Ollama.", file=sys.stderr)
#         return _call_ollama(prompt)

# # ---------- Report Rendering (unchanged) ----------
# def _as_bullets(value: Any) -> str:
#     if isinstance(value, list):
#         items = [str(item).strip() for item in value if str(item).strip()]
#     else:
#         items = [line.strip("- ").strip() for line in str(value).splitlines() if line.strip()]
#     if not items:
#         return "-"
#     return "\n".join(f"- {item}" for item in items)

# def _render_report(req: GradeRequest, structured: Dict[str, Any], warning: str = "") -> str:
#     intro_line = (
#         "This report includes an Overall Evaluation, highlights Strengths of the Submission, "
#         "identifies Areas That Need Improvement, offers Suggestions for Improvement, "
#         "and concludes with an Overall Comment."
#     )
#     criteria_lines = ["1. The rubric criteria"]
#     for crit in structured["rubric_criteria_feedback"]:
#         criteria_lines.append(f"- {crit['criterion']}: {crit['feedback']}")
#         criteria_lines.append("")
#     strengths = f"1) Overall strengths: {structured['overall_strengths']}"
#     weaknesses = f"2) Overall weaknesses: {structured['overall_weaknesses']}"
#     warning_section = ""
#     if warning:
#         warning_section = f"\n[SYSTEM NOTE: {warning}]\n"
#     body = f"""{intro_line}

# {warning_section}
# Feedback criteria for all entries of the portfolio
# {chr(10).join(criteria_lines)}

# 2. Overall strength and weaknesses
# {strengths}
# {weaknesses}

# """
#     return body

# def _render_feedback(structured: Dict[str, Any]) -> str:
#     return f"""AI Learning Feedback Report

# 1. Overall Feedback
# {structured["overall_feedback"]}

# 2. Main Improvement Areas
# {_as_bullets(structured["main_improvement_areas"])}

# 3. Practical Suggestions
# {_as_bullets(structured["practical_suggestions"])}

# 4. Final Advice
# {structured["final_advice"]}
# """

# def _validate_report_text(report: str) -> None:
#     if not report.strip():
#         raise ValueError("Generated report is empty.")
#     required_sections = [
#         "Feedback criteria for all entries of the portfolio",
#         "1. The rubric criteria",
#         "2. Overall strength and weaknesses",
#     ]
#     missing = [section for section in required_sections if section not in report]
#     if missing:
#         raise ValueError(f"Generated report is missing sections: {', '.join(missing)}")

# def _validate_feedback_text(feedback: str) -> None:
#     if not feedback.strip():
#         raise ValueError("Generated feedback is empty.")
#     required_sections = [
#         "AI Learning Feedback Report",
#         "1. Overall Feedback",
#         "2. Main Improvement Areas",
#         "3. Practical Suggestions",
#         "4. Final Advice",
#     ]
#     missing = [section for section in required_sections if section not in feedback]
#     if missing:
#         raise ValueError(f"Generated feedback is missing sections: {', '.join(missing)}")
#     if _feedback_text_has_unsafe_content(feedback):
#         raise ValueError("Generated feedback contained restricted grading or rubric language.")

# # ---------- Health Endpoint (updated) ----------
# @app.get("/health")
# def health():
#     return {
#         "ok": True,
#         "ai_provider": AI_PROVIDER,
#         "active_model": ACTIVE_MODEL,
#         "ollama_base_url": OLLAMA_BASE_URL if AI_PROVIDER == "ollama" else None,
#     }

# # ---------- Grade Endpoint (modified) ----------
# @app.post("/grade", response_model=GradeResponse)
# def grade(req: GradeRequest):
#     raw_output_debug = ""
#     try:
#         # Extract text for prompt (still used for both Ollama and Gemini)
#         max_input = MAX_INPUT_CHARS_FOR_SMALL_MODEL if "4b" in OLLAMA_MODEL.lower() or "3b" in OLLAMA_MODEL.lower() else MAX_EXTRACTED_CHARS
#         rubric_text = rubric_content(req, max_input)
#         submission_text = submission_content(req, max_input)

#         # # NEW: Collect all file paths for vision
#         # file_paths = []
#         # if req.rubric.file_path and os.path.exists(req.rubric.file_path):
#         #     file_paths.append(req.rubric.file_path)
#         # if req.submission.file_path and os.path.exists(req.submission.file_path):
#         #     file_paths.append(req.submission.file_path)
#         # if req.submission.files:
#         #     for f in req.submission.files:
#         #         if f.file_path and os.path.exists(f.file_path):
#         #             file_paths.append(f.file_path)


#         file_paths = []
#         seen_file_paths = set()

#         if req.rubric.file_path and os.path.exists(req.rubric.file_path):
#             file_paths.append(req.rubric.file_path)
#             seen_file_paths.add(os.path.abspath(req.rubric.file_path))

#         if req.submission.file_path and os.path.exists(req.submission.file_path):
#             path = os.path.abspath(req.submission.file_path)

#             if path not in seen_file_paths:
#                 file_paths.append(req.submission.file_path)
#                 seen_file_paths.add(path)

#         if req.submission.files:
#             for f in req.submission.files:

#                 if not f.file_path or not os.path.exists(f.file_path):
#                     continue

#                 path = os.path.abspath(f.file_path)

#                 if path not in seen_file_paths:
#                     file_paths.append(f.file_path)
#                     seen_file_paths.add(path)

#         first_error = None
#         structured = None

#         for attempt in range(3):
#             try:
#                 enforce_no_repeat = (attempt >= 1)
#                 prompt = _build_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt > 0 and first_error else None,
#                     enforce_no_repeat=enforce_no_repeat,
#                 )
#                 # NEW: Use unified AI caller with file paths
#                 raw_response = _call_ai(prompt, file_paths)
#                 raw_output_debug = json.dumps(raw_response, indent=2)
#                 structured = _validate_structured(raw_response)

#                 if structured["total_score"] == 0.0 and all(
#                     "No feedback" in crit["feedback"] for crit in structured["rubric_criteria_feedback"]
#                 ):
#                     raise ValueError("Model output appears to be default placeholders; retrying.")

#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 2:
#                     print("=" * 80, file=sys.stderr)
#                     print(f"GRADING FAILED after 3 attempts. Last raw LLM output:\n{raw_output_debug}", file=sys.stderr)
#                     print("=" * 80, file=sys.stderr)
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid grading output.")

#         warning = ""
#         if structured["total_score"] == 0.0 and all(
#             "No feedback" in crit["feedback"] for crit in structured["rubric_criteria_feedback"]
#         ):
#             warning = "The model's output was incomplete; some sections have been filled with defaults. Please review manually."

#         report = _render_report(req, structured, warning)
#         _validate_report_text(report)

#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="graded",
#             ai_grade=structured["total_score"],
#             ai_report_text=report,
#             ai_model=ACTIVE_MODEL,   # UPDATED: use active model name
#         )
#     except Exception as exc:
#         if raw_output_debug:
#             print("=" * 80, file=sys.stderr)
#             print(f"GRADING FAILED with error: {exc}\nRaw LLM output at failure:\n{raw_output_debug}", file=sys.stderr)
#             print("=" * 80, file=sys.stderr)
#         return GradeResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             ai_grade=None,
#             ai_report_text=None,
#             ai_model=ACTIVE_MODEL,
#             error=str(exc),
#         )

# # ---------- Feedback Endpoint (modified) ----------
# @app.post("/feedback", response_model=FeedbackResponse)
# def feedback(req: GradeRequest):
#     raw_output_debug = ""
#     try:
#         max_input = MAX_INPUT_CHARS_FOR_SMALL_MODEL if "4b" in OLLAMA_MODEL.lower() or "3b" in OLLAMA_MODEL.lower() else MAX_EXTRACTED_CHARS
#         rubric_text = rubric_content(req, max_input)
#         submission_text = submission_content(req, max_input)

#         # # NEW: Collect file paths for vision
#         # file_paths = []
#         # if req.rubric.file_path and os.path.exists(req.rubric.file_path):
#         #     file_paths.append(req.rubric.file_path)
#         # if req.submission.file_path and os.path.exists(req.submission.file_path):
#         #     file_paths.append(req.submission.file_path)
#         # if req.submission.files:
#         #     for f in req.submission.files:
#         #         if f.file_path and os.path.exists(f.file_path):
#         #             file_paths.append(f.file_path)


#         file_paths = []
#         seen_file_paths = set()

#         if req.rubric.file_path and os.path.exists(req.rubric.file_path):
#             file_paths.append(req.rubric.file_path)
#             seen_file_paths.add(os.path.abspath(req.rubric.file_path))

#         if req.submission.file_path and os.path.exists(req.submission.file_path):
#             path = os.path.abspath(req.submission.file_path)

#             if path not in seen_file_paths:
#                 file_paths.append(req.submission.file_path)
#                 seen_file_paths.add(path)

#         if req.submission.files:
#             for f in req.submission.files:

#                 if not f.file_path or not os.path.exists(f.file_path):
#                     continue

#                 path = os.path.abspath(f.file_path)

#                 if path not in seen_file_paths:
#                     file_paths.append(f.file_path)
#                     seen_file_paths.add(path)

#         first_error = None
#         structured = None

#         for attempt in range(3):
#             try:
#                 enforce_no_repeat = (attempt >= 1)
#                 prompt = _build_feedback_prompt(
#                     req,
#                     rubric_text,
#                     submission_text,
#                     correction=str(first_error) if attempt > 0 and first_error else None,
#                     enforce_no_repeat=enforce_no_repeat,
#                 )
#                 # NEW: Use unified AI caller with file paths
#                 raw_response = _call_ai(prompt, file_paths)
#                 raw_output_debug = json.dumps(raw_response, indent=2)
#                 structured = _validate_feedback_structured(raw_response)

#                 if (
#                     structured["overall_feedback"] == FEEDBACK_SAFE_FALLBACKS["overall_feedback"]
#                     and structured["main_improvement_areas"] == [FEEDBACK_SAFE_FALLBACKS["main_improvement_areas"]]
#                     and structured["practical_suggestions"] == [FEEDBACK_SAFE_FALLBACKS["practical_suggestions"]]
#                     and structured["final_advice"] == FEEDBACK_SAFE_FALLBACKS["final_advice"]
#                 ):
#                     raise ValueError("Model output appears to be default fallbacks; retrying.")

#                 break
#             except Exception as exc:
#                 first_error = exc
#                 if attempt == 2:
#                     print("=" * 80, file=sys.stderr)
#                     print(f"FEEDBACK FAILED after 3 attempts. Last raw LLM output:\n{raw_output_debug}", file=sys.stderr)
#                     print("=" * 80, file=sys.stderr)
#                     raise

#         if structured is None:
#             raise ValueError("LLM did not return valid feedback output.")

#         feedback_text = _render_feedback(structured)
#         _validate_feedback_text(feedback_text)

#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="completed",
#             feedback_text=feedback_text,
#             ai_model=ACTIVE_MODEL,   # UPDATED
#         )
#     except Exception as exc:
#         if raw_output_debug:
#             print("=" * 80, file=sys.stderr)
#             print(f"FEEDBACK FAILED with error: {exc}\nRaw LLM output at failure:\n{raw_output_debug}", file=sys.stderr)
#             print("=" * 80, file=sys.stderr)
#         return FeedbackResponse(
#             portfolio_id=req.portfolio_id,
#             status="failed",
#             feedback_text=None,
#             ai_model=ACTIVE_MODEL,
#             error=str(exc),
#         )