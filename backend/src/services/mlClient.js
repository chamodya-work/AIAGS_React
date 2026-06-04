import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const ML_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";
const timeoutSeconds = Number(process.env.AI_GRADING_TIMEOUT_SECONDS || 120);
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || timeoutSeconds * 1000);

export async function gradePortfolio(payload) {
  const portfolioId = payload?.portfolio_id || payload?.portfolio?.portfolio_id;

  try {
    const resp = await axios.post(
      `${ML_URL}/grade`,
      payload,
      {
        timeout: ML_TIMEOUT_MS,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    return resp.data;
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const code = err?.code;

    console.error("ML gradePortfolio failed:", {
      portfolioId,
      code,
      status,
      message: err?.message,
      mlError: data?.error || data?.detail || null,
    });

    throw new Error(
      data?.error
        ? `ML service error (${status}): ${data.error}`
        : data?.detail
          ? `ML service error (${status}): ${JSON.stringify(data.detail)}`
          : status
            ? `ML service error (${status})`
            : `ML request failed: ${err?.message || String(err)}`
    );
  }
}

export async function requestStudentFeedback(payload) {
  const portfolioId = payload?.portfolio_id || payload?.portfolio?.portfolio_id;

  try {
    const resp = await axios.post(
      `${ML_URL}/feedback`,
      payload,
      {
        timeout: ML_TIMEOUT_MS,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    return resp.data;
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const code = err?.code;

    console.error("ML requestStudentFeedback failed:", {
      portfolioId,
      code,
      status,
      message: err?.message,
      mlError: data?.error || data?.detail || null,
    });

    throw new Error(
      data?.error
        ? `ML service error (${status}): ${data.error}`
        : data?.detail
          ? `ML service error (${status}): ${JSON.stringify(data.detail)}`
          : status
            ? `ML service error (${status})`
            : `ML request failed: ${err?.message || String(err)}`
    );
  }
}
