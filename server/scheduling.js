import { nanoid } from 'nanoid';
import { getDB } from './db.js';
import { createError, ErrorTypes } from './errors.js';

// Helpers for date/time operations
export function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
  return new Date(d.setDate(diff));
}

export function parseHour(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours + (minutes || 0) / 60;
}

export function formatHour(hour) {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// Slot generation with blackout handling
export async function generateWeekSlots(resourceId, weekStartDate) {
  const db = await getDB();
  const start = startOfWeek(weekStartDate || new Date());

  return await db.transaction(async () => {
    // Get resource
    const resource = await db.get('SELECT * FROM resources WHERE id = ?', resourceId);
    if (!resource) throw createError(ErrorTypes.NOT_FOUND);

    // Get recurring rules
    const rules = await db.all(
      'SELECT * FROM recurringRules WHERE resourceId = ?',
      resourceId
    );

    // Get one-off blackouts
    const blackouts = await db.all(
      'SELECT * FROM blackoutDates WHERE resourceId = ? AND start >= ? AND end <= ?',
      resourceId,
      start.toISOString(),
      new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    );

    const openTime = Number(process.env.OPEN_TIME || 8);
    const closeTime = Number(process.env.CLOSE_TIME || 20);
    const slotLength = Number(process.env.SLOT_LENGTH || 120); // minutes
    const slotsPerDay = Math.floor((closeTime - openTime) * 60 / slotLength);

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const dayStart = new Date(start);
      dayStart.setDate(dayStart.getDate() + dayOffset);
      const dayOfWeek = dayStart.getDay() || 7; // Convert to 1-7 (Mon-Sun)

      for (let slotIndex = 0; slotIndex < slotsPerDay; slotIndex++) {
        const slotStart = new Date(dayStart);
        slotStart.setHours(openTime + Math.floor(slotIndex * slotLength / 60));
        slotStart.setMinutes((slotIndex * slotLength) % 60);

        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotStart.getMinutes() + slotLength);

        // Check for recurring blocks
        const isRecurringBlocked = rules.some(rule => {
          if (rule.dayOfWeek !== dayOfWeek) return false;
          const slotStartHour = slotStart.getHours() + slotStart.getMinutes() / 60;
          const slotEndHour = slotEnd.getHours() + slotEnd.getMinutes() / 60;
          return slotStartHour >= rule.startHour && slotEndHour <= rule.endHour;
        });

        // Check for one-off blackouts
        const isBlackedOut = blackouts.some(blackout => {
          const blackoutStart = new Date(blackout.start);
          const blackoutEnd = new Date(blackout.end);
          return slotStart >= blackoutStart && slotEnd <= blackoutEnd;
        });

        const blocked = isRecurringBlocked || isBlackedOut;
        const blockedLabel = isRecurringBlocked 
          ? rules.find(r => r.dayOfWeek === dayOfWeek)?.label
          : blackouts.find(b => {
              const bs = new Date(b.start);
              const be = new Date(b.end);
              return slotStart >= bs && slotEnd <= be;
            })?.reason;

        try {
          await db.run(
            `INSERT INTO slots (id, resourceId, start, end, blocked, blockedLabel)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(resourceId, start, end) DO UPDATE SET
             blocked = ?, blockedLabel = ?`,
            nanoid(10), resourceId, slotStart.toISOString(), slotEnd.toISOString(),
            blocked, blockedLabel, blocked, blockedLabel
          );
        } catch (err) {
          if (!err.message.includes('UNIQUE constraint')) throw err;
        }
      }
    }

    // Return generated slots
    return await db.all(
      `SELECT * FROM slots 
       WHERE resourceId = ? 
       AND start >= ? 
       AND start < ?
       ORDER BY start`,
      resourceId,
      start.toISOString(),
      new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    );
  });
}

// Recurring rule management
export async function addRecurringRule(resourceId, rule, actorId) {
  const db = await getDB();

  return await db.transaction(async () => {
    // Validate actor has admin rights
    const actor = await db.get(
      'SELECT role FROM users WHERE id = ?',
      actorId
    );
    if (actor?.role !== 'admin') throw createError(ErrorTypes.NOT_ALLOWED);

    // Create rule
    const ruleId = nanoid(8);
    await db.run(
      `INSERT INTO recurringRules 
       (id, resourceId, dayOfWeek, startHour, endHour, label, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ruleId, resourceId, rule.dayOfWeek, rule.startHour, rule.endHour,
      rule.label, actorId
    );

    // Regenerate affected slots
    await generateWeekSlots(resourceId, new Date());

    return await db.get('SELECT * FROM recurringRules WHERE id = ?', ruleId);
  });
}

// Blackout management
export async function addBlackoutDate(resourceId, blackout, actorId) {
  const db = await getDB();

  return await db.transaction(async () => {
    // Validate actor has admin rights
    const actor = await db.get(
      'SELECT role FROM users WHERE id = ?',
      actorId
    );
    if (actor?.role !== 'admin') throw createError(ErrorTypes.NOT_ALLOWED);

    // Create blackout
    const blackoutId = nanoid(8);
    await db.run(
      `INSERT INTO blackoutDates
       (id, resourceId, start, end, reason, createdBy)
       VALUES (?, ?, ?, ?, ?, ?)`,
      blackoutId, resourceId, blackout.start, blackout.end,
      blackout.reason, actorId
    );

    // Update affected slots
    await db.run(
      `UPDATE slots
       SET blocked = 1, blockedLabel = ?
       WHERE resourceId = ?
       AND start >= ?
       AND end <= ?`,
      blackout.reason, resourceId, blackout.start, blackout.end
    );

    return await db.get('SELECT * FROM blackoutDates WHERE id = ?', blackoutId);
  });
}