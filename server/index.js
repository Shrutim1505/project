import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

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
// Auth routes
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });
  const user = { id: nanoid(8), name, email, passwordHash: bcrypt.hashSync(password, 8), role: role || 'student' };
  users.push(user);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = users.find(u => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});


app.get('/api/resources', (_req, res) => {
  res.json(resources);
});

app.get('/api/slots', (req, res) => {
  const { resourceId } = req.query;
  let result = Array.from(slots.values());
  if (resourceId) {
    result = result.filter(s => s.resourceId === resourceId);
  }
  // Sort by start time
  result.sort((a, b) => new Date(a.start) - new Date(b.start));
  res.json(result);
});

// ----- Admin: Resources CRUD -----
app.post('/api/admin/resources', (req, res) => {
  const { name, capacity } = req.body;
  if (!name || !capacity || capacity < 1) return res.status(400).json({ error: 'Invalid name or capacity' });
  const id = nanoid(8);
  const resource = { id, name, capacity: Number(capacity) };
  resources.push(resource);
  // generate slots for current week for this resource
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
      const slotId = nanoid(10);
      slots.set(slotId, { id: slotId, resourceId: id, start: start.toISOString(), end: end.toISOString(), bookings: [], waitlist: [], blocked: false });
    }
  }
  res.json(resource);
});

app.put('/api/admin/resources/:id', (req, res) => {
  const { id } = req.params;
  const r = resources.find(r => r.id === id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const { name, capacity } = req.body;
  if (name) r.name = name;
  if (capacity !== undefined) r.capacity = Math.max(1, Number(capacity));
  res.json(r);
});

app.delete('/api/admin/resources/:id', (req, res) => {
  const { id } = req.params;
  const idx = resources.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  resources.splice(idx, 1);
  // remove slots
  for (const [sid, s] of Array.from(slots.entries())) {
    if (s.resourceId === id) slots.delete(sid);
  }
  res.json({ ok: true });
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

app.post('/api/book', (req, res) => {
  const { userId, slotId } = req.body;
  const slot = slots.get(slotId);
  if (!slot) return res.status(404).json({ error: 'Slot not found' });
  const resource = resources.find(r => r.id === slot.resourceId);
  if (!resource) return res.status(404).json({ error: 'Resource not found' });
  if (slot.blocked) return res.status(400).json({ error: 'Slot is blocked by admin schedule' });

  if (slot.bookings.includes(userId)) {
    return res.json({ status: 'already_booked', slot });
  }
  if (slot.waitlist.includes(userId)) {
    return res.json({ status: 'already_waitlisted', slot });
  }

  if (slot.bookings.length < resource.capacity) {
    slot.bookings.push(userId);
    slots.set(slot.id, slot);
    broadcast('booking_confirmed', { slotId: slot.id, userId });
    return res.json({ status: 'booked', slot });
  }

  slot.waitlist.push(userId);
  slots.set(slot.id, slot);
  broadcast('waitlisted', { slotId: slot.id, userId, position: slot.waitlist.length });
  return res.json({ status: 'waitlisted', position: slot.waitlist.length, slot });
});

app.post('/api/cancel', (req, res) => {
  const { userId, slotId } = req.body;
  const slot = slots.get(slotId);
  if (!slot) return res.status(404).json({ error: 'Slot not found' });
  const resource = resources.find(r => r.id === slot.resourceId);
  if (!resource) return res.status(404).json({ error: 'Resource not found' });

  const wasBooked = slot.bookings.includes(userId);
  const wasWaitlisted = slot.waitlist.includes(userId);

  if (!wasBooked && !wasWaitlisted) {
    return res.status(400).json({ error: 'User has no booking or waitlist entry for this slot' });
  }

  if (wasBooked) {
    slot.bookings = slot.bookings.filter(id => id !== userId);
  }
  if (wasWaitlisted) {
    slot.waitlist = slot.waitlist.filter(id => id !== userId);
  }

  // Promote next waitlisted user if capacity available
  while (slot.bookings.length < resource.capacity && slot.waitlist.length > 0) {
    const promotedUserId = slot.waitlist.shift();
    slot.bookings.push(promotedUserId);
    broadcast('promoted', { slotId: slot.id, userId: promotedUserId });
  }

  slots.set(slot.id, slot);
  broadcast('slot_updated', { slotId: slot.id, slot });
  res.json({ status: 'cancelled', slot });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: connected\n` + `data: {"ok":true}\n\n`);
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


