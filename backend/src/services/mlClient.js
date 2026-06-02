import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const ML_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";

// ✅ 10 minutes (change if you want)
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || 10 * 60 * 1000);

export async function gradePortfolio({ portfolioId, filePath, rubricText }) {
  try {
    const resp = await axios.post(
      `${ML_URL}/grade`,
      {
        portfolio_id: portfolioId,
        file_path: filePath,
        rubric: rubricText || null,
      },
      {
        timeout: ML_TIMEOUT_MS,
        // optional but helpful if ML returns large JSON report
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    return resp.data;
  } catch (err) {
    // ✅ Make timeouts + ML errors visible in Node logs
    const isAxios = !!err?.isAxiosError;
    const status = err?.response?.status;
    const data = err?.response?.data;
    const code = err?.code;

    console.error("ML gradePortfolio failed:", {
      portfolioId,
      filePath,
      code,
      status,
      data,
      message: err?.message,
    });

    // Re-throw a clean error so your controller captures it per portfolio
    throw new Error(
      data?.detail
        ? `ML service error (${status}): ${JSON.stringify(data.detail)}`
        : status
          ? `ML service error (${status}): ${JSON.stringify(data)}`
          : `ML request failed: ${err?.message || String(err)}`
    );
  }
}

