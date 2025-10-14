import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DB singleton
let _db = null;

export async function initDB() {
  if (_db) return _db;
  
  _db = await open({
    filename: `${__dirname}/data.sqlite`,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await _db.run('PRAGMA foreign_keys = ON');

  // Create tables if they don't exist
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student', 'ta', 'admin')),
      notificationsEnabled BOOLEAN NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0)
    );

    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      resourceId TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      blocked BOOLEAN NOT NULL DEFAULT 0,
      blockedLabel TEXT,
      FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
      UNIQUE (resourceId, start, end)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      slotId TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('confirmed', 'waitlisted')),
      waitlistPosition INTEGER,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (slotId) REFERENCES slots(id) ON DELETE CASCADE,
      UNIQUE (userId, slotId)
    );

    CREATE TABLE IF NOT EXISTS auditLog (
      id TEXT PRIMARY KEY,
      actorId TEXT NOT NULL,
      action TEXT NOT NULL,
      targetId TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actorId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS recurringRules (
      id TEXT PRIMARY KEY,
      resourceId TEXT NOT NULL,
      dayOfWeek INTEGER NOT NULL CHECK (dayOfWeek BETWEEN 1 AND 7),
      startHour INTEGER NOT NULL CHECK (startHour BETWEEN 0 AND 23),
      endHour INTEGER NOT NULL CHECK (endHour BETWEEN 1 AND 24),
      label TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdBy TEXT NOT NULL,
      FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
      FOREIGN KEY (createdBy) REFERENCES users(id),
      CHECK (endHour > startHour)
    );

    CREATE TABLE IF NOT EXISTS blackoutDates (
      id TEXT PRIMARY KEY,
      resourceId TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      reason TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdBy TEXT NOT NULL,
      FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
      FOREIGN KEY (createdBy) REFERENCES users(id)
    );
  `);

  return _db;
}

export async function getDB() {
  if (!_db) throw new Error('Database not initialized');
  return _db;
}

// Booking transaction helpers
export async function bookSlot(userId, slotId) {
  const db = await getDB();
  
  return await db.transaction(async () => {
    // Get slot and resource info with row lock
    const slot = await db.get(
      `SELECT s.*, r.capacity, COUNT(b.id) as bookedCount
       FROM slots s
       JOIN resources r ON s.resourceId = r.id
       LEFT JOIN bookings b ON s.id = b.slotId AND b.status = 'confirmed'
       WHERE s.id = ?
       GROUP BY s.id`,
      slotId
    );

    if (!slot) throw { code: 'NOT_FOUND', message: 'Slot not found' };
    if (slot.blocked) throw { code: 'SLOT_BLOCKED', message: 'Slot is blocked' };
    
    // Check if user already has a booking
    const existing = await db.get(
      'SELECT * FROM bookings WHERE userId = ? AND slotId = ?',
      userId, slotId
    );
    if (existing) throw { code: 'ALREADY_BOOKED', message: 'Already booked or waitlisted' };

    // Check for overlapping bookings
    const hasOverlap = await db.get(
      `SELECT b.id FROM bookings b
       JOIN slots s ON b.slotId = s.id
       WHERE b.userId = ?
       AND b.status = 'confirmed'
       AND s.resourceId = ?
       AND s.start < ? AND s.end > ?`,
      userId, slot.resourceId, slot.end, slot.start
    );
    if (hasOverlap) throw { code: 'OVERLAP_CONFLICT', message: 'Overlapping booking exists' };

    // Check if slot is in the past
    if (new Date(slot.start) < new Date()) {
      throw { code: 'PAST_SLOT', message: 'Cannot book past slots' };
    }

    if (slot.bookedCount < slot.capacity) {
      // Direct confirmation
      await db.run(
        'INSERT INTO bookings (id, userId, slotId, status) VALUES (?, ?, ?, ?)',
        nanoid(10), userId, slotId, 'confirmed'
      );
      return { status: 'confirmed' };
    } else {
      // Add to waitlist
      const maxPosition = await db.get(
        'SELECT MAX(waitlistPosition) as max FROM bookings WHERE slotId = ? AND status = ?',
        slotId, 'waitlisted'
      );
      const position = (maxPosition?.max || 0) + 1;
      
      await db.run(
        'INSERT INTO bookings (id, userId, slotId, status, waitlistPosition) VALUES (?, ?, ?, ?, ?)',
        nanoid(10), userId, slotId, 'waitlisted', position
      );
      return { status: 'waitlisted', position };
    }
  });
}

export async function cancelBooking(bookingId, actorId) {
  const db = await getDB();
  
  return await db.transaction(async () => {
    // Get booking with lock
    const booking = await db.get(
      `SELECT b.*, s.resourceId, u.role as actorRole 
       FROM bookings b
       JOIN slots s ON b.slotId = s.id
       JOIN users u ON u.id = ?
       WHERE b.id = ?`,
      actorId, bookingId
    );

    if (!booking) throw { code: 'NOT_FOUND', message: 'Booking not found' };

    // Check permissions
    if (booking.userId !== actorId && booking.actorRole === 'student') {
      throw { code: 'NOT_ALLOWED', message: 'Not authorized to cancel this booking' };
    }

    // Check grace period for confirmed bookings
    if (booking.status === 'confirmed') {
      const slot = await db.get('SELECT * FROM slots WHERE id = ?', booking.slotId);
      const graceMinutes = process.env.GRACE_MINUTES || 5;
      const now = new Date();
      const start = new Date(slot.start);
      const graceMsec = graceMinutes * 60 * 1000;
      
      if (now > start || (start - now) < graceMsec) {
        throw { code: 'GRACE_PERIOD', message: 'Too close to start time' };
      }
    }

    // Delete the booking
    await db.run('DELETE FROM bookings WHERE id = ?', bookingId);

    // If it was confirmed, try to promote someone from waitlist
    if (booking.status === 'confirmed') {
      const next = await db.get(
        `SELECT b.* FROM bookings b
         WHERE b.slotId = ? AND b.status = 'waitlisted'
         ORDER BY b.waitlistPosition ASC
         LIMIT 1`,
        booking.slotId
      );

      if (next) {
        // Promote to confirmed
        await db.run(
          'UPDATE bookings SET status = ?, waitlistPosition = NULL WHERE id = ?',
          'confirmed', next.id
        );

        // Reindex remaining waitlist
        await db.run(
          `UPDATE bookings 
           SET waitlistPosition = waitlistPosition - 1
           WHERE slotId = ? AND status = 'waitlisted' AND waitlistPosition > ?`,
          booking.slotId, next.waitlistPosition
        );

        return { status: 'canceled', promoted: next.userId };
      }
    }

    return { status: 'canceled' };
  });
}

// Lightweight status endpoints
export async function getSlotStatus(slotId) {
  const db = await getDB();
  
  const status = await db.get(
    `SELECT 
       s.id,
       s.blocked,
       r.capacity,
       COUNT(CASE WHEN b.status = 'confirmed' THEN 1 END) as confirmedCount,
       COUNT(CASE WHEN b.status = 'waitlisted' THEN 1 END) as waitlistCount
     FROM slots s
     JOIN resources r ON s.resourceId = r.id
     LEFT JOIN bookings b ON s.id = b.slotId
     WHERE s.id = ?
     GROUP BY s.id`,
    slotId
  );

  if (!status) throw { code: 'NOT_FOUND', message: 'Slot not found' };
  return status;
}

export async function getSlotWaitlist(slotId) {
  const db = await getDB();
  
  return await db.all(
    `SELECT 
       b.id as bookingId,
       b.userId,
       b.waitlistPosition,
       u.name as userName
     FROM bookings b
     JOIN users u ON b.userId = u.id
     WHERE b.slotId = ? AND b.status = 'waitlisted'
     ORDER BY b.waitlistPosition ASC`,
    slotId
  );
}