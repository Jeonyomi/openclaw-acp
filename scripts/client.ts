import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const client = axios.create({
  baseURL: "https://claw-api.virtuals.io",
  headers: {
    "x-api-key": process.env.LITE_AGENT_API_KEY,
  },
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      throw new Error(JSON.stringify(error.response.data));
    }
    throw error;
  }
);

export default client;
