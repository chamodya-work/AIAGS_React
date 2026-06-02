import os
import re
import sys
import json
import types
from typing import Optional, Any, Dict, List

import joblib
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel

import ollama

app = FastAPI(title="AIGS ML Service", version="1.0")

MODEL_PATH = os.getenv("MODEL_PATH", "./model.pkl")

_model = None

class GradeRequest(BaseModel):
    portfolio_id: int
    file_path: str
    rubric: Optional[str] = None

class GradeResponse(BaseModel):
    portfolio_id: int
    ai_grade: float
    ai_review_report: str


# --- Your regressor expects these short criterion IDs ---
# (Confirmed by inspecting b33_ca1_regressor.pkl)
CRITERION_MODEL_IDS: Dict[str, str] = {
    # long_id from rubric -> model short id
    "C_OVERALL_PRESENTATION_AND_ORGAN": "C1_OVERALL",
    "C_SELF_INTRODUCTION": "C2_SELF_INTRO",
    "C_REFLECTION_ON_MORAL_DILEMMA": "C3_MORAL_DILEMMA",
    "C_REFLECTION_ON_GROUP_ACTIVITY": "C4_GROUP_ACTIVITY",
    "C_REFLECTION_ON_DEVELOPING_EMOTIONAL_INTELLIGENCE": "C5_EMOTIONAL_INTELLIGENCE",
    "C_DISCUSSION_AND_FUTURE_ACTIVITY_PLAN": "C6_FUTURE_PLAN",
    "C_SUPPORTING_DOCUMENTS_INCLUDING_PROFESSIONALISM_INDEX": "C7_PROFESSIONALISM",
    "C_REFLECTION_ON_ATTITUDES_ABOUT_GENDER_AND_SEXUALITY": "C8_GENDER_ATTITUDES",
}

DEFAULT_RUBRIC: Dict[str, Any] = {
    "rubric_id": "DEFAULT_B33_CA1",
    "rubric_name": "B33 CA1 Reflective Portfolio (Default)",
    "criteria": [
        {"criterion_id": "C_OVERALL_PRESENTATION_AND_ORGAN", "criterion_name": "Overall presentation and organization of content", "weight": 3},
        {"criterion_id": "C_SELF_INTRODUCTION", "criterion_name": "Self-introduction", "weight": 2},
        {"criterion_id": "C_REFLECTION_ON_MORAL_DILEMMA", "criterion_name": "Reflection on moral dilemma", "weight": 4},
        {"criterion_id": "C_REFLECTION_ON_GROUP_ACTIVITY", "criterion_name": "Reflection on group activity", "weight": 4},
        {"criterion_id": "C_REFLECTION_ON_DEVELOPING_EMOTIONAL_INTELLIGENCE", "criterion_name": "Reflection on developing emotional intelligence", "weight": 4},
        {"criterion_id": "C_DISCUSSION_AND_FUTURE_ACTIVITY_PLAN", "criterion_name": "Discussion and future activity plan", "weight": 3},
        {"criterion_id": "C_SUPPORTING_DOCUMENTS_INCLUDING_PROFESSIONALISM_INDEX", "criterion_name": "Supporting documents including professionalism index", "weight": 2},
        {"criterion_id": "C_REFLECTION_ON_ATTITUDES_ABOUT_GENDER_AND_SEXUALITY", "criterion_name": "Reflection on attitudes about gender and sexuality", "weight": 3},
    ],
}


def load_model():
    global _model
    if _model is not None:
        return _model

    # Compatibility shim:
    # Some pickles created with NumPy 2.x refer to internal modules like `numpy._core`.
    # If this service runs on NumPy 1.x, loading can fail unless we provide aliases.
    try:
        import numpy as np  # noqa
        import numpy.core as ncore
        if "numpy._core" not in sys.modules:
            core_mod = types.ModuleType("numpy._core")
            core_mod.__dict__.update(ncore.__dict__)
            sys.modules["numpy._core"] = core_mod
        try:
            import numpy.core._multiarray_umath as mau
            if "numpy._core._multiarray_umath" not in sys.modules:
                mau_mod = types.ModuleType("numpy._core._multiarray_umath")
                mau_mod.__dict__.update(mau.__dict__)
                sys.modules["numpy._core._multiarray_umath"] = mau_mod
        except Exception:
            pass
    except Exception:
        pass

    if os.path.exists(MODEL_PATH):
        _model = joblib.load(MODEL_PATH)
    else:
        _model = None
    return _model


def extract_text(file_path: str) -> str:
    """
    Extract text from supported file types:
    - PDF (.pdf)
    - Word (.docx)
    - Plain text (fallback)
    """

    if not file_path or not os.path.exists(file_path):
        return ""

    ext = os.path.splitext(file_path)[1].lower()

    # ================= PDF =================
    if ext == ".pdf":
        # Try pdfplumber first
        try:
            import pdfplumber
            text_parts = []

            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text() or ""
                    if page_text.strip():
                        text_parts.append(page_text)

            text = "\n".join(text_parts)
            if text.strip():
                return text

        except Exception as e:
            print("pdfplumber failed:", e)

        # Fallback: PyMuPDF
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(file_path)
            text_parts = []

            for page in doc:
                page_text = page.get_text("text") or ""
                if page_text.strip():
                    text_parts.append(page_text)

            return "\n".join(text_parts)

        except Exception as e:
            print("PyMuPDF failed:", e)
            return ""

    # ================= DOCX =================
    if ext == ".docx":
        try:
            from docx import Document

            doc = Document(file_path)
            text_parts = []

            for paragraph in doc.paragraphs:
                if paragraph.text and paragraph.text.strip():
                    text_parts.append(paragraph.text.strip())

            # Also extract text from tables (important for portfolios)
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text and cell.text.strip():
                            text_parts.append(cell.text.strip())

            return "\n".join(text_parts)

        except Exception as e:
            print("DOCX extraction failed:", e)
            return ""

    # ================= TXT / FALLBACK =================
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception as e:
        print("Fallback text read failed:", e)
        return ""



def _safe_parse_rubric(rubric_text: Optional[str]) -> Dict[str, Any]:
    """Accept rubric JSON (preferred). If rubric text is missing/invalid, use DEFAULT_RUBRIC.

    The LLM prompt works best with rubric JSON. We keep a fallback so the system
    still runs even when the UI stores rubric as plain text.
    """
    if not rubric_text:
        return DEFAULT_RUBRIC

    try:
        obj = json.loads(rubric_text)
        if isinstance(obj, dict) and ("criteria" in obj or "criteria_scores" in obj):
            # Normalize to our expected shape: { rubric_id, criteria:[{criterion_id, criterion_name, weight}] }
            if "criteria" in obj and isinstance(obj["criteria"], list):
                return obj
        # If JSON but not expected shape, keep as description.
        r = dict(DEFAULT_RUBRIC)
        r["rubric_id"] = obj.get("rubric_id", r["rubric_id"]) if isinstance(obj, dict) else r["rubric_id"]
        r["rubric_name"] = obj.get("rubric_name", r["rubric_name"]) if isinstance(obj, dict) else r["rubric_name"]
        r["rubric_description"] = obj
        return r
    except Exception:
        r = dict(DEFAULT_RUBRIC)
        r["rubric_description"] = rubric_text
        return r


def _build_prompt(rubric: Dict[str, Any], portfolio_id: int, portfolio_text: str) -> str:
    rubric_json_str = json.dumps(rubric, ensure_ascii=False, indent=2)
    return f"""
You are an experienced Sri Lankan medical education assessor.
You must evaluate a B33 CA1 Reflective Portfolio using the OFFICIAL marking rubric.

==================== RUBRIC (JSON) ====================
{rubric_json_str}

==================== PORTFOLIO ====================
Portfolio ID: {portfolio_id}
Assignment: B33 CA1 Reflective Portfolio

TEXT:
\"\"\"
{portfolio_text}
\"\"\"

==================== INSTRUCTIONS ====================
1. Use ONLY the rubric to decide the score for each criterion.
2. Each criterion is scored 0–4 (integer).
3. Weightage = the "weight" field in the rubric → Final score for a criterion = score × weight.
4. For each criterion you MUST produce:
   - score (0–4)
   - max_score (always 4)
   - weightage (integer from rubric)
   - weighted_score = score × weightage
   - justification (2–4 sentences)
   - feedback (clear, helpful comments)
5. Final total_score = sum(weighted_score for all criteria).
6. Output MUST be STRICT JSON with this EXACT structure:

{{
  "portfolio_id": "{portfolio_id}",
  "rubric_id": "{rubric.get('rubric_id','')}",
  "overall_comment": "Overall summary.",
  "criteria_scores": [
    {{"criterion_id":"C_OVERALL_PRESENTATION_AND_ORGAN","criterion_name":"Overall presentation and organization of content","score":0,"max_score":4,"weightage":3,"weighted_score":0,"justification":"…","feedback":"…"}},
    {{"criterion_id":"C_SELF_INTRODUCTION","criterion_name":"Self-introduction","score":0,"max_score":4,"weightage":2,"weighted_score":0,"justification":"…","feedback":"…"}},
    {{"criterion_id":"C_REFLECTION_ON_MORAL_DILEMMA","criterion_name":"Reflection on moral dilemma","score":0,"max_score":4,"weightage":4,"weighted_score":0,"justification":"…","feedback":"…"}},
    {{"criterion_id":"C_REFLECTION_ON_GROUP_ACTIVITY","criterion_name":"Reflection on group activity","score":0,"max_score":4,"weightage":4,"weighted_score":0,"justification":"…","feedback":"…"}},
    {{"criterion_id":"C_REFLECTION_ON_DEVELOPING_EMOTIONAL_INTELLIGENCE","criterion_name":"Reflection on developing emotional intelligence","score":0,"max_score":4,"weightage":4,"weighted_score":0,"justification":"…","feedback":"…"}},
    {{"criterion_id":"C_DISCUSSION_AND_FUTURE_ACTIVITY_PLAN","criterion_name":"Discussion and future activity plan","score":0,"max_score":4,"weightage":3,"weighted_score":0,"justification":"…","feedback":"…"}},
    {{"criterion_id":"C_SUPPORTING_DOCUMENTS_INCLUDING_PROFESSIONALISM_INDEX","criterion_name":"Supporting documents including professionalism index","score":0,"max_score":4,"weightage":2,"weighted_score":0,"justification":"…","feedback":"…"}},
    {{"criterion_id":"C_REFLECTION_ON_ATTITUDES_ABOUT_GENDER_AND_SEXUALITY","criterion_name":"Reflection on attitudes about gender and sexuality","score":0,"max_score":4,"weightage":3,"weighted_score":0,"justification":"…","feedback":"…"}}
  ],
  "total_score": 0
}}

IMPORTANT:
- DO NOT output markdown.
- DO NOT explain your reasoning outside the JSON.
- RETURN ONLY VALID JSON (a single JSON object).
"""


def _extract_first_json(raw_output: str) -> Dict[str, Any]:
    raw_output = (raw_output or "").strip()
    if not raw_output:
        raise ValueError("Model returned empty output.")

    # Strip markdown fences if present
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

    dec = json.JSONDecoder()
    for i, ch in enumerate(raw_output):
        if ch == "{":
            try:
                obj, _end = dec.raw_decode(raw_output[i:])
                return obj
            except json.JSONDecodeError:
                continue

    start = raw_output.find("{")
    end = raw_output.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("Model did not return JSON.")
    obj, _end = dec.raw_decode(raw_output[start : end + 1])
    return obj


def _grade_with_ollama(portfolio_id: int, rubric: Dict[str, Any], portfolio_text: str) -> Dict[str, Any]:
    model_name = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
    prompt = _build_prompt(rubric, portfolio_id, portfolio_text)
    resp = ollama.chat(
        model=model_name,
        messages=[{"role": "user", "content": prompt}],
        stream=False,
    )
    raw_output = resp["message"]["content"].strip()
    return _extract_first_json(raw_output)


@app.get("/health")
def health():
    return {"ok": True, "model_loaded": bool(load_model())}


@app.post("/grade", response_model=GradeResponse)
def grade(req: GradeRequest):
    """End-to-end grading:
    1) Extract text from the uploaded portfolio file.
    2) Ask the local Ollama LLM to score each rubric criterion (0-4) + justification/feedback.
    3) For each criterion, use b33_ca1_regressor.pkl to convert raw LLM score -> predicted FINAL WEIGHTED SCORE.
       (You confirmed the regressor target is the final weighted score.)
    4) Sum predicted weighted scores to compute overall total AI grade.
    """

    model = None
    portfolio_text = extract_text(req.file_path)

    # Parse rubric from DB (preferred). If DB stores plain text, fall back to default rubric.
    rubric: Dict[str, Any] = DEFAULT_RUBRIC
    rubric_source = "default"
    if req.rubric:
        try:
            rubric = json.loads(req.rubric)
            if not isinstance(rubric, dict):
                raise ValueError("rubric JSON must be an object")
            rubric_source = "db_json"
        except Exception:
            rubric = dict(DEFAULT_RUBRIC)
            rubric["rubric_notes"] = req.rubric
            rubric_source = "db_text_fallback"

    # --- Step 1: LLM criterion scoring ---
    try:
        llm_result = _grade_with_ollama(req.portfolio_id, rubric, portfolio_text)
    except Exception as e:
        # If Ollama is not running / model missing, return a clear error.
        err_report = {
            "error": "LLM grading failed. Ensure Ollama is installed and the model is pulled.",
            "ollama_model": os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
            "details": str(e),
        }
        return GradeResponse(portfolio_id=req.portfolio_id, ai_grade=0.0, ai_review_report=json.dumps(err_report, ensure_ascii=False, indent=2))

    criteria_scores: List[Dict[str, Any]] = llm_result.get("criteria_scores") or []
    overall_comment = llm_result.get("overall_comment")

    # --- Step 2: Calibrate with regressor per criterion ---
    calibrated_rows: List[Dict[str, Any]] = []
    total_predicted_weighted = 0.0

    if model is None:
        # No regressor → fall back to raw weighted_score from the LLM output
        for cs in criteria_scores:
            total_predicted_weighted += float(cs.get("weighted_score", 0) or 0)
        final_report = {
            "portfolio_id": req.portfolio_id,
            "rubric_source": rubric_source,
            "llm": llm_result,
            "calibration": {
                "regressor_loaded": False,
                "note": "model.pkl not loaded; using LLM weighted_score as AI grade.",
            },
            "ai_total_score": total_predicted_weighted,
        }
        return GradeResponse(portfolio_id=req.portfolio_id, ai_grade=float(total_predicted_weighted), ai_review_report=json.dumps(final_report, ensure_ascii=False, indent=2))

    for cs in criteria_scores:
        long_id = cs.get("criterion_id")
        model_id = CRITERION_MODEL_IDS.get(long_id)
        llm_score_raw = cs.get("score")

        if model_id is None or llm_score_raw is None:
            # Skip malformed entries
            continue

        try:
            llm_score_raw = float(llm_score_raw)
        except Exception:
            continue

        X = pd.DataFrame([{ "llm_score": llm_score_raw, "criterion_id": model_id }])
        pred = model.predict(X)
        predicted_weighted = float(pred[0])

        # Safety clamp: predicted weighted score cannot be negative
        predicted_weighted = max(0.0, predicted_weighted)
        total_predicted_weighted += predicted_weighted

        calibrated_rows.append({
            "criterion_id": long_id,
            "criterion_model_id": model_id,
            "criterion_name": cs.get("criterion_name"),
            "llm_score_raw_0_4": llm_score_raw,
            "weightage": cs.get("weightage"),
            "llm_weighted_score": cs.get("weighted_score"),
            "predicted_weighted_score": predicted_weighted,
            "justification": cs.get("justification"),
            "feedback": cs.get("feedback"),
        })

    final_report = {
        "portfolio_id": req.portfolio_id,
        "rubric_source": rubric_source,
        "overall_comment": overall_comment,
        "criteria": calibrated_rows,
        "ai_total_score": total_predicted_weighted,
        "calibration": {
            "regressor_loaded": True,
            "model_path": MODEL_PATH,
            "ollama_model": os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
        },
    }

    return GradeResponse(
        portfolio_id=req.portfolio_id,
        ai_grade=float(total_predicted_weighted),
        ai_review_report=json.dumps(final_report, ensure_ascii=False, indent=2),
    )
