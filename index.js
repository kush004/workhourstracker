import express from "express";
import session from "express-session";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// 🧩 Directory setup for EJS views
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ✅ Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret-key",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(express.static("public"));

// ✅ MongoDB connection
const client = new MongoClient(process.env.MONGO_URI);
let usersCollection, jobsCollection, dailyJobsCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "workhoursdb");
    usersCollection = db.collection("users");
    jobsCollection = db.collection("jobs");
    dailyJobsCollection = db.collection("daily_jobs");
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}
connectDB();

// 🏠 Home route
app.get("/", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const jobs = await jobsCollection.find({ username: req.session.user }).toArray();
  const dailyJobs = await dailyJobsCollection.find({ username: req.session.user }).toArray();

  res.render("home", { username: req.session.user, jobs, dailyJobs });
});

// 🧑‍💻 Register
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.render("register", { error: "All fields are required!" });
  }

  const userExists = await usersCollection.findOne({ email });
  if (userExists) {
    return res.render("register", { error: "Email already registered!" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await usersCollection.insertOne({ username, email, password: hashedPassword });

  res.redirect("/login");
});

// 🔐 Login
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await usersCollection.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.render("login", { error: "Invalid email or password!" });
  }

  // ✅ Store only username (avoid circular BSON)
  req.session.user = user.username;

  res.redirect("/");
});

// 🚪 Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// 💼 Add job
app.post("/add-job", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { jobName, date, salaryType, salaryAmount } = req.body;

  if (!jobName || !date || !salaryType || !salaryAmount) {
    return res.redirect("/");
  }

  await jobsCollection.insertOne({
    username: req.session.user,
    jobName,
    date,
    salaryType,
    salaryAmount: Number(salaryAmount),
    createdAt: new Date(),
  });

  res.redirect("/");
});

// 🕒 Add daily job entry
app.post("/add-daily-job", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { jobName, date, startTime, endTime } = req.body;

  if (!jobName || !date || !startTime || !endTime) {
    return res.redirect("/");
  }

  const start = new Date(`${date}T${startTime}`);
  const end = new Date(`${date}T${endTime}`);
  const totalHours = (end - start) / (1000 * 60 * 60);

  await dailyJobsCollection.insertOne({
    username: req.session.user,
    jobName,
    date,
    startTime,
    endTime,
    totalHours,
    createdAt: new Date(),
  });

  res.redirect("/");
});
  
// 🌐 Start server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
