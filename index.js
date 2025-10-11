// index.js
import express from 'express';
import session from 'express-session';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'mysecret';

// ===== MongoDB Setup =====
const client = new MongoClient(process.env.MONGO_URI, { useUnifiedTopology: true });
await client.connect();
const db = client.db('workhoursDB');

const usersCollection = db.collection('users');
const jobsCollection = db.collection('jobs');
const dailyJobsCollection = db.collection('daily_jobs');

console.log('✅ MongoDB connected');

// ===== Middleware =====
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: true }));

// ===== ROUTES =====

// Home page
app.get('/', (req, res) => {
  if (req.session.user) {
    res.render('home_page', { username: req.session.user });
  } else {
    res.redirect('/login');
  }
});

// About Us page
app.get('/about_us', (req, res) => {
  if (req.session.user) {
    res.render('about_us', { username: req.session.user });
  } else {
    res.redirect('/login');
  }
});

// ===== REGISTER =====
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username || !email || !password || !confirmPassword) {
    return res.render('register', { error: "All fields are required!" });
  }
  if (password !== confirmPassword) {
    return res.render('register', { error: "Passwords do not match!" });
  }

  const existingUser = await usersCollection.findOne({ email });
  if (existingUser) return res.render('register', { error: "Email already registered!" });

  const hashedPassword = await bcrypt.hash(password, 10);
  await usersCollection.insertOne({ username, email, password: hashedPassword });

  res.redirect('/login');
});

// ===== LOGIN =====
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await usersCollection.findOne({ email });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.render('login', { error: "Invalid email or password!" });
  }

  req.session.user = user.username;
  res.redirect('/');
});

// ===== LOGOUT =====
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ===== JOB ENTRY PAGE =====
app.get("/jobentry", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const jobs = await jobsCollection.find({ username: req.session.user }).toArray();

  res.render("jobEntry_page", {
    username: req.session.user,
    jobs,
    jobError: null,
    jobSuccess: null,
    dailyError: null,
    dailySuccess: null
  });
});

// POST new job
app.post("/jobentry", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { jobName, date, salaryType, salaryAmount } = req.body;
  const jobs = await jobsCollection.find({ username: req.session.user }).toArray();

  // Validation
  if (!jobName || !date || !salaryType || !salaryAmount) {
    return res.render("jobEntry_page", {
      username: req.session.user,
      jobError: "All fields are required!",
      jobSuccess: null,
      dailyError: null,
      dailySuccess: null,
      jobs
    });
  }

  const existingJob = await jobsCollection.findOne({ username: req.session.user, jobName });
  if (existingJob) {
    return res.render("jobEntry_page", {
      username: req.session.user,
      jobError: "This job name already exists!",
      jobSuccess: null,
      dailyError: null,
      dailySuccess: null,
      jobs
    });
  }

  await jobsCollection.insertOne({
    username: req.session.user,
    jobName: jobName.trim(),
    date,
    salaryType,
    salaryAmount: Number(salaryAmount),
    createdAt: new Date()
  });

  const updatedJobs = await jobsCollection.find({ username: req.session.user }).toArray();

  res.render("jobEntry_page", {
    username: req.session.user,
    jobError: null,
    jobSuccess: "Job added successfully!",
    dailyError: null,
    dailySuccess: null,
    jobs: updatedJobs
  });
});

// POST daily job entry
app.post("/dailyjob", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { jobName, todayDate, startTime, endTime, totalHours } = req.body;
  const jobs = await jobsCollection.find({ username: req.session.user }).toArray();

  // Validation
  if (!jobName || !todayDate || !startTime || !endTime || !totalHours) {
    return res.render("jobEntry_page", {
      username: req.session.user,
      jobError: null,
      jobSuccess: null,
      dailyError: "All fields are required!",
      dailySuccess: null,
      jobs
    });
  }

  const enteredDateStr = new Date(todayDate).toISOString().split("T")[0];
  const todayStr = new Date().toISOString().split("T")[0];

  if (enteredDateStr !== todayStr) {
    return res.render("jobEntry_page", {
      username: req.session.user,
      jobError: null,
      jobSuccess: null,
      dailyError: "You can only enter today's date!",
      dailySuccess: null,
      jobs
    });
  }

  const existingEntry = await dailyJobsCollection.findOne({
    username: req.session.user,
    jobName,
    date: todayDate
  });

  if (existingEntry) {
    return res.render("jobEntry_page", {
      username: req.session.user,
      jobError: null,
      jobSuccess: null,
      dailyError: `You have already added '${jobName}' for ${todayDate}!`,
      dailySuccess: null,
      jobs
    });
  }

  await dailyJobsCollection.insertOne({
    username: req.session.user,
    jobName,
    date: todayDate,
    startTime,
    endTime,
    totalHours: Number(totalHours),
    createdAt: new Date()
  });

  return res.render("jobEntry_page", {
    username: req.session.user,
    jobError: null,
    jobSuccess: null,
    dailyError: null,
    dailySuccess: "Daily job entry saved successfully!",
    jobs
  });
});

// Job Data + Charts
app.get("/JobData", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const userJobs = await jobsCollection.find({ username: req.session.user }).toArray();
  const userDailyJobs = await dailyJobsCollection.find({ username: req.session.user }).toArray();

  // Bar Chart: Monthly Hours per Job
  let jobHours = {};
  userDailyJobs.forEach(job => {
    const monthKey = `${new Date(job.date).getFullYear()}-${String(new Date(job.date).getMonth() + 1).padStart(2, "0")}`;
    if (!jobHours[job.jobName]) jobHours[job.jobName] = {};
    jobHours[job.jobName][monthKey] = (jobHours[job.jobName][monthKey] || 0) + job.totalHours;
  });

  // Pie Chart: Total Days per Job (this month)
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  let totalDaysData = {};
  userDailyJobs.forEach(job => {
    const date = new Date(job.date);
    if (date.getFullYear() === currentYear && date.getMonth() + 1 === currentMonth) {
      totalDaysData[job.jobName] = (totalDaysData[job.jobName] || 0) + 1;
    }
  });

  res.render("jobdata_page", {
    username: req.session.user,
    jobs: userJobs,
    daily_jobs: userDailyJobs,
    chartData: JSON.stringify(jobHours),
    totalDaysData: JSON.stringify(totalDaysData)
  });
});

// ===== Start Server =====
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
