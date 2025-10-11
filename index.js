import express from 'express';
import session from 'express-session';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
// const port = process.env.PORT || 3200;

const client = new MongoClient(process.env.MONGO_URI);
//for hosting
await client.connect();
const dbName  = client.db('workhoursDB');
const SESSION_SECRET = process.env.SESSION_SECRET || 'mysecret';

// MongoDB setup for compass
// const dbName = "workhoursDB";
// const url = "mongodb://localhost:27017";
// const client = new MongoClient(url);

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: true }));

// Connect to MongoDB once
let usersCollection;
async function connectDB() {
  await client.connect();
  const db = client.db(dbName);
  usersCollection = db.collection('users');
  console.log('✅ MongoDB connected');
}
connectDB();

// ===== ROUTES =====

// Home page
app.get('/', (req, res) => {
  if (req.session.user) {
    res.render('home_page', { username: req.session.user });
  } else {
    res.redirect('/login');
  }
});

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
// GET Job Entry Page
app.get("/jobentry", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const db = client.db(dbName);
  const jobsCollection = db.collection("jobs");
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
  const db = client.db(dbName);
  const jobsCollection = db.collection("jobs");

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

  // Insert new job
  await jobsCollection.insertOne({
    username: req.session.user,
    jobName,
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
// POST daily job entry
app.post("/dailyjob", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const { jobName, todayDate, startTime, endTime, totalHours } = req.body;
  const db = client.db(dbName);
  const jobsCollection = db.collection("jobs");
  const dailyJobs = db.collection("daily_jobs");

  const jobs = await jobsCollection.find({ username: req.session.user }).toArray();

  // Validation: all fields required
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

  // 🕒 Check if the entered date is today's date
  const enteredDate = new Date(todayDate);
  const today = new Date();

  // Convert both to YYYY-MM-DD (ignore time part)
  const enteredDateStr = enteredDate.toISOString().split("T")[0];
  const todayStr = today.toISOString().split("T")[0];

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

  // 🧠 Check if user already added same job for same date
  const existingEntry = await dailyJobs.findOne({
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

  // ✅ Save the job entry if all good
  await dailyJobs.insertOne({
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


// Show jobs + daily jobs in one page
app.get("/JobData", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const db = client.db(dbName);
  const jobsCollection = db.collection("jobs");
  const dailyJobsCollection = db.collection("daily_jobs");

  // Get jobs
  const userJobs = await jobsCollection.find({ username: req.session.user }).toArray();
  const userDailyJobs = await dailyJobsCollection.find({ username: req.session.user }).toArray();

  // ==== Bar Chart: Monthly Hours per Job ====
  let jobHours = {};
  userDailyJobs.forEach(job => {
    const date = new Date(job.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!jobHours[job.jobName]) jobHours[job.jobName] = {};
    if (!jobHours[job.jobName][monthKey]) jobHours[job.jobName][monthKey] = 0;
    jobHours[job.jobName][monthKey] += job.totalHours;
  });

  // ==== Pie Chart: Total Days per Job (this month) ====
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  let totalDaysData = {};
  userDailyJobs.forEach(job => {
    const date = new Date(job.date);
    if (date.getFullYear() === currentYear && date.getMonth() + 1 === currentMonth) {
      if (!totalDaysData[job.jobName]) totalDaysData[job.jobName] = 0;
      totalDaysData[job.jobName] += 1; // count day
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


// Start server
// app.listen(port, () => console.log(`🚀 Server running on http://localhost:${port}`));
