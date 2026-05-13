require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = 3001; // The frontend expects http://localhost:3001/api
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me-later';

// Connect to Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Supabase cloud
});

app.use(cors());
app.use(express.json());

// --- Middleware: Verify JWT Token ---
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid Token' });
  }
};

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role) 
       VALUES ($1, $2, $3, 'member') RETURNING *`,
      [email.toLowerCase(), hash, name]
    );
    const user = rows[0];
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.full_name, email: user.email, role: user.role, avColor: user.avatar_color, created: user.created_at } });
  } catch (err) {
    console.error("🔴 DATABASE ERROR:", err); // هاد السطر غادي يطبع لينا الخطأ فالتيرمينال
    res.status(500).json({ error: 'Server error' });
  }
//   catch (err) {
//     res.status(400).json({ error: 'Email might already exist.' });
//   }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.full_name, email: user.email, role: user.role, avColor: user.avatar_color, created: user.created_at } });
  } 
  catch (err) {
    console.error("🔴 DATABASE ERROR:", err); // هاد السطر غادي يطبع لينا الخطأ فالتيرمينال
    res.status(500).json({ error: 'Server error' });
  }
//   catch (err) {
//     res.status(500).json({ error: 'Server error' });
//   }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
  const user = rows[0];
  res.json({ user: { id: user.id, name: user.full_name, email: user.email, role: user.role, avColor: user.avatar_color, created: user.created_at } });
});

// ============================================================================
// TODOS ROUTES
// ============================================================================

app.get('/api/todos', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, content AS txt, priority AS pri, tag, TO_CHAR(due_date, 'YYYY-MM-DD') AS due, is_done AS done 
     FROM todos WHERE user_id = $1 ORDER BY created_at DESC`, 
    [req.user.id]
  );
  res.json(rows);
});

app.post('/api/todos', auth, async (req, res) => {
  const { txt, pri, tag, due } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO todos (user_id, content, priority, tag, due_date) 
     VALUES ($1, $2, $3, $4, $5) 
     RETURNING id, content AS txt, priority AS pri, tag, TO_CHAR(due_date, 'YYYY-MM-DD') AS due, is_done AS done`,
    [req.user.id, txt, pri, tag, due || null]
  );
  res.json(rows[0]);
});

app.put('/api/todos/:id', auth, async (req, res) => {
  const { done } = req.body;
  await pool.query(`UPDATE todos SET is_done = $1, done_at = NOW() WHERE id = $2 AND user_id = $3`, [done, req.params.id, req.user.id]);
  res.json({ success: true });
});

app.delete('/api/todos/:id', auth, async (req, res) => {
  await pool.query(`DELETE FROM todos WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ============================================================================
// HABITS ROUTES
// ============================================================================

app.get('/api/habits', auth, async (req, res) => {
  const habitsRes = await pool.query(`SELECT id, name, color FROM habits WHERE user_id = $1`, [req.user.id]);
  const logsRes = await pool.query(
    `SELECT habit_id, TO_CHAR(log_date, 'YYYY-MM-DD') AS date FROM habit_logs WHERE user_id = $1`, 
    [req.user.id]
  );
  
  const habits = habitsRes.rows.map(h => {
    const doneObj = {};
    logsRes.rows.filter(l => l.habit_id === h.id).forEach(l => doneObj[l.date] = true);
    return { ...h, done: doneObj };
  });
  res.json(habits);
});

app.post('/api/habits', auth, async (req, res) => {
  const { name, color } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO habits (user_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color`, 
    [req.user.id, name, color]
  );
  res.json({ ...rows[0], done: {} });
});

app.put('/api/habits/:id/log', auth, async (req, res) => {
  const { date, done } = req.body;
  if (done) {
    await pool.query(`INSERT INTO habit_logs (habit_id, user_id, log_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [req.params.id, req.user.id, date]);
  } else {
    await pool.query(`DELETE FROM habit_logs WHERE habit_id = $1 AND log_date = $2 AND user_id = $3`, [req.params.id, date, req.user.id]);
  }
  res.json({ success: true });
});

app.delete('/api/habits/:id', auth, async (req, res) => {
  await pool.query(`DELETE FROM habits WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ============================================================================
// PLANNER BLOCKS ROUTES
// ============================================================================

app.get('/api/planner', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, start_time AS start, end_time AS end, color, TO_CHAR(planned_date, 'YYYY-MM-DD') AS date 
     FROM planner_blocks WHERE user_id = $1`, 
    [req.user.id]
  );
  res.json(rows);
});

app.post('/api/planner', auth, async (req, res) => {
  const { title, start, end, color, date } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO planner_blocks (user_id, title, start_time, end_time, color, planned_date) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.user.id, title, start, end, color, date]
  );
  res.json({ id: rows[0].id, title, start, end, color, date });
});

app.delete('/api/planner/:id', auth, async (req, res) => {
  await pool.query(`DELETE FROM planner_blocks WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ============================================================================
// POMODORO ROUTES
// ============================================================================

app.get('/api/pomodoro/stats', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT 
      COUNT(*) AS sessions, 
      COALESCE(SUM(duration_mins), 0) AS "focusMins" 
    FROM pomodoro_sessions 
    WHERE user_id = $1 AND completed_at::date = CURRENT_DATE
  `, [req.user.id]);
  
  res.json({
    sessions: parseInt(rows[0].sessions),
    focusMins: parseInt(rows[0].focusMins),
    streak: 1, // Simplified for MVP
    weekData: [0,0,0,0,0,0,0],
    hourly: {},
    daily: {}
  });
});

app.post('/api/pomodoro/session', auth, async (req, res) => {
  const { durationMins, sessionType } = req.body;
  await pool.query(
    `INSERT INTO pomodoro_sessions (user_id, session_type, duration_mins) VALUES ($1, $2, $3)`,
    [req.user.id, sessionType || 'focus', durationMins]
  );
  res.json({ success: true });
});

// ============================================================================
// ADMIN ROUTES
// ============================================================================

app.get('/api/admin/users', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query(`SELECT id, full_name AS name, email, role, is_active, avatar_color AS "avColor" FROM users`);
  res.json(rows);
});

app.get('/api/admin/kpis', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM users`);
  res.json({ total: rows[0].total, active: rows[0].total, onlineToday: 1, totalSessions: 0, announcements: 0 });
});


// ============================================================================
// ANNOUNCEMENTS ROUTES
// ============================================================================

// يجيب الإعلانات للمستخدمين
app.get('/api/announcements', auth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.id, a.message AS msg, 
           TO_CHAR(a.created_at, 'YYYY-MM-DD') AS date, 
           TO_CHAR(a.created_at, 'HH24:MI') AS time,
           (ad.user_id IS NOT NULL) AS dismissed
    FROM announcements a
    LEFT JOIN announcement_dismissals ad ON ad.announcement_id = a.id AND ad.user_id = $1
    ORDER BY a.created_at DESC
  `, [req.user.id]);
  res.json(rows);
});

// الأدمن كيصيفط إعلان جديد
app.post('/api/admin/announcements', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { msg } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO announcements (message) VALUES ($1) 
     RETURNING id, message AS msg, 
     TO_CHAR(created_at, 'YYYY-MM-DD') AS date, 
     TO_CHAR(created_at, 'HH24:MI') AS time`,
    [msg]
  );
  res.json(rows[0]);
});

// الأدمن كيمسح إعلان
app.delete('/api/admin/announcements/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// المستخدم كيحيد الإعلان من الشاشة ديالو
app.post('/api/announcements/:id/dismiss', auth, async (req, res) => {
  await pool.query(
    'INSERT INTO announcement_dismissals (announcement_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.params.id, req.user.id]
  );
  res.json({ success: true });
});


module.exports = app;
// app.listen(PORT, () => {
//   console.log(`🚀 Focus API is running smoothly on http://localhost:${PORT}`);
// });