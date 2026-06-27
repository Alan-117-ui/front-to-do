import axios from "axios";

export const api = axios.create({
  baseURL: "http://localhost:4000/api",
});

export function setAuth(token: string | null) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
}