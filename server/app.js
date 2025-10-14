import express from 'express';
import jwt from 'jsonwebtoken';
import { initDB } from './db.js';
import { handleError } from './errors.js';
import { authMiddleware, requireRole, guardCapacityChange, guardAnalytics, auditLog } from './middleware/rbac.js';

const app = express();
app.use(express.json());

// Initialize database connection and attach to app
const db = await initDB();
app.locals.db = db;

// Error handling middleware
app.use((err, req, res, next) => {
  handleError(err, res);
});

// Authentication middleware for protected routes
// Apply auth middleware to all /api routes
app.use('/api', authMiddleware);

// Apply additional admin role check to all /api/admin routes
app.use('/api/admin', requireRole('ADMIN'));

// Resource management endpoints (admin only)
app.post('/api/admin/resources', auditLog('create_resource'), async (req, res) => {
  const { name, capacity } = req.body;
  try {
    const result = await db.run(
      'INSERT INTO resources (id, name, capacity) VALUES (?, ?, ?)',
      nanoid(8), name, capacity
    );
    res.json({ id: result.lastID });
  } catch (err) {
    next(err);
  }
});

// Slot management endpoints
app.get('/api/slots', async (req, res) => {
  const { resourceId } = req.query;
  try {
    const slots = await db.all(
      'SELECT * FROM slots WHERE resourceId = ? ORDER BY start ASC',
      resourceId
    );
    res.json(slots);
  } catch (err) {
    next(err);
  }
});

app.get('/api/slots/:id/status', async (req, res) => {
  const { id } = req.params;
  try {
    const [confirmed, waitlisted] = await Promise.all([
      db.get('SELECT COUNT(*) as count FROM bookings WHERE slotId = ? AND status = ?', id, 'confirmed'),
      db.get('SELECT COUNT(*) as count FROM bookings WHERE slotId = ? AND status = ?', id, 'waitlisted')
    ]);
    
    res.json({
      confirmedCount: confirmed.count,
      waitlistCount: waitlisted.count
    });
  } catch (err) {
    next(err);
  }
});

// Booking endpoints
app.post('/api/book', async (req, res) => {
  const { slotId, userId } = req.body;
  
  try {
    const slot = await db.get('SELECT * FROM slots WHERE id = ?', slotId);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    // Check capacity
    const confirmedCount = await db.get(
      'SELECT COUNT(*) as count FROM bookings WHERE slotId = ? AND status = ?',
      slotId, 'confirmed'
    );
    
    if (confirmedCount.count < slot.capacity) {
      // Direct booking
      const result = await db.run(
        'INSERT INTO bookings (id, slotId, userId, status) VALUES (?, ?, ?, ?)',
        nanoid(8), slotId, userId, 'confirmed'
      );
      
      res.json({
        bookingId: result.lastID,
        status: 'confirmed'
      });
    } else {
      // Add to waitlist
      const waitlistCount = await db.get(
        'SELECT COUNT(*) as count FROM bookings WHERE slotId = ? AND status = ?',
        slotId, 'waitlisted'
      );
      
      const result = await db.run(
        'INSERT INTO bookings (id, slotId, userId, status, waitlistPosition) VALUES (?, ?, ?, ?, ?)',
        nanoid(8), slotId, userId, 'waitlisted', waitlistCount.count + 1
      );
      
      res.json({
        bookingId: result.lastID,
        status: 'waitlisted',
        position: waitlistCount.count + 1
      });
    }
  } catch (err) {
    next(err);
  }
});

app.post('/api/cancel', async (req, res) => {
  const { bookingId, actorId } = req.body;
  
  try {
    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', bookingId);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Verify user owns booking or is admin
    const actor = await db.get('SELECT role FROM users WHERE id = ?', actorId);
    if (booking.userId !== actorId && actor.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to cancel this booking' });
    }
    
    await db.run(
      'UPDATE bookings SET status = ? WHERE id = ?',
      'cancelled', bookingId
    );
    
    // Promote first waitlisted booking if this was a confirmed booking
    if (booking.status === 'confirmed') {
      const nextInLine = await db.get(
        'SELECT * FROM bookings WHERE slotId = ? AND status = ? ORDER BY waitlistPosition ASC LIMIT 1',
        booking.slotId, 'waitlisted'
      );
      
      if (nextInLine) {
        await db.run(
          'UPDATE bookings SET status = ?, waitlistPosition = NULL WHERE id = ?',
          'confirmed', nextInLine.id
        );
        
        // Reorder remaining waitlist
        await db.run(`
          UPDATE bookings 
          SET waitlistPosition = waitlistPosition - 1 
          WHERE slotId = ? AND status = ? AND waitlistPosition > ?
        `, booking.slotId, 'waitlisted', nextInLine.waitlistPosition);
      }
    }
    
    res.json({ status: 'cancelled' });
  } catch (err) {
    next(err);
  }
});

// Admin rule management endpoints
app.get('/api/admin/rules', roleCheck(['admin', 'ta']), async (req, res) => {
  try {
    const rules = await db.all('SELECT * FROM recurringRules');
    res.json(rules);
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/rules', requireRole('ADMIN'), auditLog('create_rule'), async (req, res) => {
  const { resourceId, dayOfWeek, startHour, endHour, label } = req.body;
  
  try {
    const result = await db.run(
      'INSERT INTO recurringRules (id, resourceId, dayOfWeek, startHour, endHour, label) VALUES (?, ?, ?, ?, ?, ?)',
      nanoid(8), resourceId, dayOfWeek, startHour, endHour, label
    );
    
    // Immediately apply rule to existing slots
    await db.run(`
      UPDATE slots 
      SET blocked = 1, blockedLabel = ?
      WHERE resourceId = ? 
        AND strftime('%w', start) = ?
        AND strftime('%H', start) = ?
        AND strftime('%H', end) = ?
    `, label, resourceId, dayOfWeek, startHour, endHour);
    
    res.json({ id: result.lastID });
  } catch (err) {
    next(err);
  }
});

// Analytics endpoints (admin only)
app.get('/api/analytics/resources', requireRole('ADMIN'), async (req, res) => {
  try {
    const analytics = await db.all('SELECT * FROM resourceAnalytics');
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

app.get('/api/analytics/resource/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const analytics = await db.get('SELECT * FROM resourceAnalytics WHERE resourceId = ?', req.params.id);
    if (!analytics) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

app.get('/api/analytics/waitlist', requireRole('ADMIN'), async (req, res) => {
  try {
    const stats = await db.all(`
      SELECT 
        r.id as resourceId,
        r.name as resourceName,
        s.id as slotId,
        s.start,
        s.end,
        COUNT(CASE WHEN b.status = 'waitlisted' THEN 1 END) as waitlistCount,
        MAX(b.waitlistPosition) as maxWaitlistPosition
      FROM resources r
      JOIN slots s ON s.resourceId = r.id
      LEFT JOIN bookings b ON b.slotId = s.id
      WHERE b.status = 'waitlisted'
      GROUP BY r.id, r.name, s.id
      HAVING waitlistCount > 0
      ORDER BY waitlistCount DESC
    `);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default app;