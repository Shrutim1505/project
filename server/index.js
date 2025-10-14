import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { initDB, getDB, bookSlot, cancelBooking, getSlotStatus, getSlotWaitlist } from './db.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Basic security
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);

// Rate limiting
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: 'Too many booking attempts' }
});

const cancelLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: 'Too many cancellation attempts' }
});

// In-memory data
const users = [
  { id: 'u1', name: 'Alice', email: 'alice@example.com', passwordHash: bcrypt.hashSync('password', 8), role: 'student' },
  { id: 'u2', name: 'Bob', email: 'bob@example.com', passwordHash: bcrypt.hashSync('password', 8), role: 'student' },
  { id: 'u3', name: 'Carol', email: 'carol@example.com', passwordHash: bcrypt.hashSync('password', 8), role: 'student' },
  { id: 'u4', name: 'TA Tim', email: 'ta@example.com', passwordHash: bcrypt.hashSync('password', 8), role: 'ta' },
  { id: 'u5', name: 'Admin Ada', email: 'admin@example.com', passwordHash: bcrypt.hashSync('admin', 8), role: 'admin' }
];

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// resources each with capacity (number of identical units)
const resources = [
  { id: 'r1', name: 'Workstation A', capacity: 2 },
  { id: 'r2', name: 'Workstation B', capacity: 2 },
  { id: 'r3', name: '3D Printer', capacity: 1 }
];

// Slots per resource: Map<slotId, Slot>
// Slot: { id, resourceId, start, end, bookings: UserId[], waitlist: UserId[], blocked?: boolean, blockedLabel?: string }
const slots = new Map();

// Recurring rules for blocking slots (e.g., classes)
// Rule: { id, resourceId, dayOfWeek: 0-6 (Mon=1...), startHour, endHour, label }
const recurringRules = [];

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun..6 Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function generateWeekSlots() {
  const now = new Date();
  const weekStart = startOfWeek(now);
  // 7 days, from 8:00 to 20:00 in 2-hour blocks -> 6 slots/day
  const hours = [8, 10, 12, 14, 16, 18];
  for (const resource of resources) {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      for (const h of hours) {
        const start = new Date(weekStart);
        start.setDate(start.getDate() + dayOffset);
        start.setHours(h, 0, 0, 0);
        const end = new Date(start);
        end.setHours(h + 2);
        const id = nanoid(10);
        slots.set(id, {
          id,
          resourceId: resource.id,
          start: start.toISOString(),
          end: end.toISOString(),
          bookings: [],
          waitlist: [],
          blocked: false,
          blockedLabel: undefined
        });
      }
    }
  }
}

generateWeekSlots();

// SSE clients
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

app.get('/api/users', (_req, res) => {
  res.json(users.map(u => ({ id: u.id, name: u.name, role: u.role, email: u.email })));
});
// Auth routes with validation
app.post('/api/auth/register', [
  body('name').trim().isLength({ min: 2 }),
  body('email').trim().isEmail(),
  body('password').isLength({ min: 6 }),
  body('role').optional().isIn(['student', 'ta', 'admin'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array() });
  }

  const db = await getDB();
  const { name, email, password, role = 'student' } = req.body;

  try {
    // Check email uniqueness with proper index
    const existing = await db.get('SELECT 1 FROM users WHERE email = ?', email);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered', code: 'EMAIL_TAKEN' });
    }

    // Create user in transaction
    const userId = nanoid(8);
    await db.run(
      'INSERT INTO users (id, name, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)',
      userId, name, email, bcrypt.hashSync(password, 10), role
    );

    // Get created user
    const user = await db.get(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      userId
    );

    const token = jwt.sign(
      { sub: user.id, role: user.role },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '7d' }
    );

    await logAudit(userId, 'USER_REGISTERED', userId);
    res.json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/auth/login', [
  body('email').trim().isEmail(),
  body('password').isLength({ min: 1 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array() });
  }

  const db = await getDB();
  const { email, password } = req.body;

  try {
    const user = await db.get(
      'SELECT id, name, email, role, passwordHash FROM users WHERE email = ?',
      email
    );

    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '7d' }
    );

    // Don't send passwordHash to client
    const { passwordHash: _, ...safeUser } = user;
    
    await logAudit(user.id, 'USER_LOGIN', user.id);
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', code: 'INTERNAL_ERROR' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const db = await getDB();
    const user = await db.get(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      req.user.id
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }
    
    res.json(user);
  } catch (err) {
    console.error('Auth check error:', err);
    res.status(500).json({ error: 'Server error', code: 'INTERNAL_ERROR' });
  }
});


app.get('/api/resources', async (_req, res) => {
  try {
    const db = await getDB();
    const resources = await db.all('SELECT * FROM resources ORDER BY name');
    res.json(resources);
  } catch (err) {
    console.error('Resource list error:', err);
    res.status(500).json({ error: 'Failed to list resources', code: 'INTERNAL_ERROR' });
  }
});

app.get('/api/slots', async (req, res) => {
  try {
    const db = await getDB();
    const { resourceId, date } = req.query;
    
    let query = `
      SELECT 
        s.*,
        r.capacity,
        COUNT(CASE WHEN b.status = 'confirmed' THEN 1 END) as confirmedCount,
        COUNT(CASE WHEN b.status = 'waitlisted' THEN 1 END) as waitlistCount
      FROM slots s
      JOIN resources r ON s.resourceId = r.id
      LEFT JOIN bookings b ON s.id = b.slotId
      ${resourceId ? 'WHERE s.resourceId = ?' : ''}
      GROUP BY s.id
      ORDER BY s.start ASC
    `;

    const slots = await db.all(query, resourceId ? [resourceId] : []);
    res.json(slots);
  } catch (err) {
    console.error('Slot list error:', err);
    res.status(500).json({ error: 'Failed to list slots', code: 'INTERNAL_ERROR' });
  }
});

// ----- Admin: Resources CRUD -----
app.post('/api/admin/resources', [
  authMiddleware,
  checkRole('admin'),
  body('name').trim().isLength({ min: 1 }),
  body('capacity').isInt({ min: 1 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array() });
  }

  const db = await getDB();
  const { name, capacity } = req.body;

  try {
    await db.transaction(async () => {
      // Create resource
      const resourceId = nanoid(8);
      await db.run(
        'INSERT INTO resources (id, name, capacity) VALUES (?, ?, ?)',
        resourceId, name, Number(capacity)
      );

      // Generate slots for current week
      const now = new Date();
      const weekStart = startOfWeek(now);
      const hours = [8, 10, 12, 14, 16, 18];
      
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (const h of hours) {
          const start = new Date(weekStart);
          start.setDate(start.getDate() + dayOffset);
          start.setHours(h, 0, 0, 0);
          const end = new Date(start);
          end.setHours(h + 2);
          
          await db.run(
            `INSERT INTO slots (id, resourceId, start, end, blocked) 
             VALUES (?, ?, ?, ?, ?)`,
            nanoid(10), resourceId, start.toISOString(), end.toISOString(), false
          );
        }
      }

      const resource = await db.get('SELECT * FROM resources WHERE id = ?', resourceId);
      await logAudit(req.user.id, 'RESOURCE_CREATED', resourceId, { name, capacity });
      res.json(resource);
    });
  } catch (err) {
    console.error('Resource create error:', err);
    res.status(500).json({ error: 'Failed to create resource', code: 'INTERNAL_ERROR' });
  }
});

app.put('/api/admin/resources/:id', [
  authMiddleware,
  checkRole('admin'),
  body('name').optional().trim().isLength({ min: 1 }),
  body('capacity').optional().isInt({ min: 1 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array() });
  }

  const db = await getDB();
  const { id } = req.params;
  const { name, capacity } = req.body;

  try {
    await db.transaction(async () => {
      const resource = await db.get('SELECT * FROM resources WHERE id = ?', id);
      if (!resource) {
        return res.status(404).json({ error: 'Resource not found', code: 'NOT_FOUND' });
      }

      if (name || capacity) {
        await db.run(
          `UPDATE resources 
           SET ${name ? 'name = ?,' : ''} ${capacity ? 'capacity = ?' : ''} 
           WHERE id = ?`,
          ...[name, capacity, id].filter(x => x !== undefined)
        );

        await logAudit(req.user.id, 'RESOURCE_UPDATED', id, { name, capacity });
      }

      const updated = await db.get('SELECT * FROM resources WHERE id = ?', id);
      res.json(updated);
    });
  } catch (err) {
    console.error('Resource update error:', err);
    res.status(500).json({ error: 'Failed to update resource', code: 'INTERNAL_ERROR' });
  }
});

app.delete('/api/admin/resources/:id', [
  authMiddleware,
  checkRole('admin')
], async (req, res) => {
  const db = await getDB();
  const { id } = req.params;

  try {
    await db.transaction(async () => {
      const resource = await db.get('SELECT * FROM resources WHERE id = ?', id);
      if (!resource) {
        return res.status(404).json({ error: 'Resource not found', code: 'NOT_FOUND' });
      }

      // Delete resource (cascades to slots and bookings)
      await db.run('DELETE FROM resources WHERE id = ?', id);
      
      await logAudit(req.user.id, 'RESOURCE_DELETED', id, { name: resource.name });
      res.json({ ok: true });
    });
  } catch (err) {
    console.error('Resource delete error:', err);
    res.status(500).json({ error: 'Failed to delete resource', code: 'INTERNAL_ERROR' });
  }
});

// ----- Admin: Usage Stats -----
app.get('/api/admin/stats', (req, res) => {
  const byResource = {};
  for (const r of resources) {
    const resourceSlots = Array.from(slots.values()).filter(s => s.resourceId === r.id);
    const totalSlots = resourceSlots.length;
    const blockedSlots = resourceSlots.filter(s => s.blocked).length;
    const totalBookings = resourceSlots.reduce((acc, s) => acc + s.bookings.length, 0);
    const totalWaitlist = resourceSlots.reduce((acc, s) => acc + s.waitlist.length, 0);
    byResource[r.id] = {
      resource: r,
      totalSlots,
      blockedSlots,
      totalBookings,
      totalWaitlist,
      utilization: totalSlots > 0 ? totalBookings / (totalSlots * r.capacity) : 0
    };
  }
  res.json({ byResource });
});

// ----- Admin: Recurring Blocking Rules -----
function applyRecurringRulesToCurrentWeek() {
  const weekStart = startOfWeek(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  for (const s of slots.values()) {
    const start = new Date(s.start);
    if (start >= weekStart && start < weekEnd) {
      s.blocked = false;
      s.blockedLabel = undefined;
    }
  }
  for (const rule of recurringRules) {
    for (const s of slots.values()) {
      const d = new Date(s.start);
      const day = (d.getDay() === 0 ? 7 : d.getDay()); // Mon=1..Sun=7
      if (s.resourceId === rule.resourceId && day === rule.dayOfWeek && d.getHours() >= rule.startHour && d.getHours() < rule.endHour) {
        s.blocked = true;
        s.blockedLabel = rule.label || 'Blocked';
      }
    }
  }
}

app.get('/api/admin/rules', (_req, res) => {
  res.json(recurringRules);
});

app.post('/api/admin/rules', (req, res) => {
  const { resourceId, dayOfWeek, startHour, endHour, label } = req.body;
  if (!resourceId || !dayOfWeek && dayOfWeek !== 0) return res.status(400).json({ error: 'Missing fields' });
  const rule = { id: nanoid(8), resourceId, dayOfWeek: Number(dayOfWeek), startHour: Number(startHour), endHour: Number(endHour), label };
  recurringRules.push(rule);
  applyRecurringRulesToCurrentWeek();
  broadcast('rules_updated', { rule });
  res.json(rule);
});

app.delete('/api/admin/rules/:id', (req, res) => {
  const { id } = req.params;
  const idx = recurringRules.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  recurringRules.splice(idx, 1);
  applyRecurringRulesToCurrentWeek();
  broadcast('rules_updated', { id });
  res.json({ ok: true });
});

app.post('/api/book', bookingLimiter, [
  body('userId').trim().notEmpty(),
  body('slotId').trim().notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array() });
  }

  try {
    const { userId, slotId } = req.body;
    const result = await bookSlot(userId, slotId);
    
    // Emit SSE event
    if (result.status === 'confirmed') {
      broadcast('booking_confirmed', { slotId, userId });
    } else if (result.status === 'waitlisted') {
      broadcast('waitlisted', { slotId, userId, position: result.position });
    }

    res.json(result);
  } catch (err) {
    if (err.code) {
      res.status(400).json({ error: err.message, code: err.code });
    } else {
      console.error('Booking error:', err);
      res.status(500).json({ error: 'Server error', code: 'INTERNAL_ERROR' });
    }
  }
});

app.post('/api/cancel', cancelLimiter, [
  body('bookingId').trim().notEmpty(),
  body('actorId').trim().notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array() });
  }

  try {
    const { bookingId, actorId } = req.body;
    const result = await cancelBooking(bookingId, actorId);
    
    // Emit appropriate SSE events
    broadcast('booking_canceled', { bookingId });
    if (result.promoted) {
      broadcast('booking_promoted', { userId: result.promoted });
    }

    res.json(result);
  } catch (err) {
    if (err.code) {
      res.status(400).json({ error: err.message, code: err.code });
    } else {
      console.error('Cancel error:', err);
      res.status(500).json({ error: 'Server error', code: 'INTERNAL_ERROR' });
    }
  }
});

// New lightweight status endpoints
app.get('/api/slots/:id/status', async (req, res) => {
  try {
    const status = await getSlotStatus(req.params.id);
    res.json(status);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      res.status(404).json({ error: 'Slot not found' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

app.get('/api/slots/:id/waitlist', async (req, res) => {
  try {
    const waitlist = await getSlotWaitlist(req.params.id);
    res.json(waitlist);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check
app.get('/healthz', async (_req, res) => {
  try {
    const db = await getDB();
    await db.get('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Database error' });
  }
});

// SSE endpoint for real-time updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const clientId = nanoid(6);
  res.write(`event: connected\n` + `data: {"ok":true,"clientId":"${clientId}"}\n\n`);
  
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


