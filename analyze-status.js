const REDIS_URL = process.env.STORAGE_KV_REST_API_URL;
const REDIS_TOKEN = process.env.STORAGE_KV_REST_API_TOKEN;

async function redisGet(key) {
  const response = await fetch(
    `${REDIS_URL}/get/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Redis GET failed: ${response.status}`);
  }

  const data = await response.json();

  if (!data.result) {
    return null;
  }

  return JSON.parse(data.result);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const jobId = req.query.jobId;

    if (!jobId) {
      return res.status(400).json({
        error: "Missing jobId"
      });
    }

    const job = await redisGet(`career-job:${jobId}`);

    if (!job) {
      return res.status(404).json({
        error: "Job not found"
      });
    }

    return res.status(200).json(job);

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
