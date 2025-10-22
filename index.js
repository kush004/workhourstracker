import express from "express";
import session from "express-session";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import favicon from "serve-favicon";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// ----- Directory setup for EJS views -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// ----- Middleware -----
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret-key",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(favicon(path.join(__dirname, "public", "favicone", "work_hours_tracker.png")));

// ----- MongoDB connection -----
const client = new MongoClient(process.env.MONGO_URI);
let usersCollection, jobsCollection, dailyJobsCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "workhourstracker");
    usersCollection = db.collection("users");
    jobsCollection = db.collection("jobs");
    dailyJobsCollection = db.collection("daily_jobs");
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}
await connectDB();

// ----- Routes -----

// Home redirect
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect("/JobEntry");
});

// About page
app.get("/about_us", (req, res) => {
  res.render("about_us", { username: req.session.user || null });
});

// Register
app.get("/register", (req, res) => res.render("register", { error: null }));
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.render("register", { error: "All fields are required!" });

    const exists = await usersCollection.findOne({ email });
    if (exists) return res.render("register", { error: "Email already registered!" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({ username, email, password: hashedPassword });
    res.redirect("/login");
  } catch (err) {
    console.error(err);
    res.render("register", { error: "Internal server error" });
  }
});

// Login
app.get("/login", (req, res) => res.render("login", { error: null }));
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.render("login", { error: "Email and password required" });

    const user = await usersCollection.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.render("login", { error: "Invalid email or password" });

    req.session.user = user.username;
    res.redirect("/JobEntry");
  } catch (err) {
    console.error(err);
    res.render("login", { error: "Internal server error" });
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ===== Job Entry Page =====
app.get("/JobEntry", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const jobs = await jobsCollection.find({ username: req.session.user }).toArray();
  res.render("jobEntry_page", {
    username: req.session.user,
    jobs,
    jobError: null,
    jobSuccess: null,
    dailyError: null,
    dailySuccess: null,
  });
});

// Add Job
app.post("/jobentry", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  try {
    const { jobName, date, salaryType, salaryAmount } = req.body;
    if (!jobName || !date || !salaryType || !salaryAmount) return res.redirect("/JobEntry");

    const existingJob = await jobsCollection.findOne({
      username: req.session.user,
      jobName: jobName.trim(),
    });

    if (existingJob) {
      const jobs = await jobsCollection.find({ username: req.session.user }).toArray();
      return res.render("jobEntry_page", {
        username: req.session.user,
        jobs,
        jobError: "You have already added this job!",
        jobSuccess: null,
        dailyError: null,
        dailySuccess: null,
      });
    }

    await jobsCollection.insertOne({
      username: req.session.user,
      jobName: jobName.trim(),
      date,
      salaryType,
      salaryAmount: Number(salaryAmount),
      createdAt: new Date(),
    });

    res.redirect("/JobEntry");
  } catch (err) {
    console.error(err);
    res.redirect("/JobEntry");
  }
});

// Add Daily Job
app.post("/dailyjob", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  try {
    const { jobName, todayDate, startTime, endTime } = req.body;
    if (!jobName || !todayDate || !startTime || !endTime) return res.redirect("/JobEntry");

    const existingDaily = await dailyJobsCollection.findOne({
      username: req.session.user,
      jobName,
      date: todayDate,
    });

    if (existingDaily) {
      return res.redirect("/JobEntry");
    }

    let totalHours = (new Date(`${todayDate}T${endTime}`) - new Date(`${todayDate}T${startTime}`)) / (1000 * 60 * 60);
    if (totalHours < 0) totalHours += 24;

    await dailyJobsCollection.insertOne({
      username: req.session.user,
      jobName,
      date: todayDate,
      startTime,
      endTime,
      totalHours: Number(totalHours.toFixed(2)),
      createdAt: new Date(),
    });

    res.redirect("/JobEntry");
  } catch (err) {
    console.error("Daily job insert error:", err);
    res.redirect("/JobEntry");
  }
});

// ===== Job Data Page with Calculated Salary =====
app.get("/JobData", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const jobs = await jobsCollection.find({ username: req.session.user }).toArray();
  const dailyJobs = await dailyJobsCollection.find({ username: req.session.user }).toArray();

  // Map job rates
  const jobRateMap = {};
  jobs.forEach(job => {
    jobRateMap[job.jobName] = Number(job.salaryAmount);
  });

  // Add calculated salary
  const dailyJobsWithSalary = dailyJobs.map(dj => {
    const rate = jobRateMap[dj.jobName] || 0;
    const calculatedSalary = Number((dj.totalHours * rate).toFixed(2));
    return { ...dj, calculatedSalary };
  });

  // Chart data
  let jobHours = {};
  dailyJobsWithSalary.forEach(job => {
    const monthKey = `${new Date(job.date).getFullYear()}-${String(new Date(job.date).getMonth() + 1).padStart(2, "0")}`;
    if (!jobHours[job.jobName]) jobHours[job.jobName] = {};
    if (!jobHours[job.jobName][monthKey]) jobHours[job.jobName][monthKey] = 0;
    jobHours[job.jobName][monthKey] += job.totalHours;
  });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  let totalDaysData = {};
  dailyJobsWithSalary.forEach(job => {
    const date = new Date(job.date);
    if (date.getFullYear() === currentYear && date.getMonth() + 1 === currentMonth) {
      if (!totalDaysData[job.jobName]) totalDaysData[job.jobName] = 0;
      totalDaysData[job.jobName] += 1;
    }
  });

  res.render("jobdata_page", {
    username: req.session.user,
    jobs,
    daily_jobs: dailyJobsWithSalary,
    chartData: JSON.stringify(jobHours),
    totalDaysData: JSON.stringify(totalDaysData),
  });
});

// ===== Edit Job Page =====
app.get("/edit-job/:id", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  try {
    const job = await jobsCollection.findOne({
      _id: new ObjectId(req.params.id),
      username: req.session.user,
    });
    if (!job) return res.status(404).send("Job not found");
    res.render("edit_job", { job, username: req.session.user });
  } catch (err) {
    console.error("Error loading job:", err);
    res.status(500).send("Error loading job data.");
  }
});

// ===== Update Job =====
app.post("/update-job", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const { jobId, jobName, date, salaryType, salaryAmount } = req.body;

  try {
    const result = await jobsCollection.updateOne(
      { _id: new ObjectId(jobId), username: req.session.user },
      { $set: { jobName, date, salaryType, salaryAmount: Number(salaryAmount) } }
    );
    if (result.matchedCount === 0) return res.status(404).send("Job not found or cannot edit");
    res.redirect("/JobData");
  } catch (err) {
    console.error("Error updating job:", err);
    res.status(500).send("Failed to update job.");
  }
});

// ===== Edit Daily Job Page =====
app.get("/edit-daily-job/:id", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  try {
    const job = await dailyJobsCollection.findOne({
      _id: new ObjectId(req.params.id),
      username: req.session.user,
    });
    if (!job) return res.status(404).send("Daily job not found");
    res.render("edit_daily_job", { job, username: req.session.user });
  } catch (err) {
    console.error("Error loading daily job:", err);
    res.status(500).send("Error loading daily job data.");
  }
});

// ===== Update Daily Job =====
app.post("/update-daily-job", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const { dailyJobId, jobName, date, startTime, endTime } = req.body;

  try {
    let totalHours = (new Date(`${date}T${endTime}`) - new Date(`${date}T${startTime}`)) / (1000 * 60 * 60);
    if (totalHours < 0) totalHours += 24;

    await dailyJobsCollection.updateOne(
      { _id: new ObjectId(dailyJobId), username: req.session.user },
      { $set: { jobName, date, startTime, endTime, totalHours: Number(totalHours.toFixed(2)) } }
    );

    res.redirect("/JobData");
  } catch (err) {
    console.error("Error updating daily job:", err);
    res.status(500).send("Failed to update daily job.");
  }
});

// ===== Delete Job =====
app.post("/delete-job/:id", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  try {
    await jobsCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      username: req.session.user,
    });
    res.redirect("/JobData");
  } catch (err) {
    console.error("Error deleting job:", err);
    res.status(500).send("Failed to delete job.");
  }
});

// ===== Delete Daily Job =====
app.post("/delete-daily-job/:id", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  try {
    await dailyJobsCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      username: req.session.user,
    });
    res.redirect("/JobData");
  } catch (err) {
    console.error("Error deleting daily job:", err);
    res.status(500).send("Failed to delete daily job.");
  }
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
