import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

//routes import

import userRouter from "./routes/user.routes.js";
import router from "./routes/userSettings.routes.js";
import mediaRouter from "./routes/model.routes.js";
import postRouter from "./routes/post.routes.js";
import commentRouter from "./routes/comment.routes.js";

//routes declaration
app.use("/api/v1/users", userRouter);
app.use("/api/v1/userSettings", router);
app.use("/api/v1/models", mediaRouter);
app.use("/api/v1/post", postRouter);
app.use("/api/v1/comment", commentRouter);

// http://localhost:8000/api/v1/users/register

export { app };
