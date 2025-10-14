import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { initDB } from '../db.js';
import { bookSlot, cancelBooking } from '../db.js';

// Test helpers
async function createTestUser(db, role = 'student') {
  const userId = nanoid(8);
  await db.run(
    'INSERT INTO users (id, name, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)',
    userId,
    `Test User ${userId}`,
    `test-${userId}@example.com`,
    'hash',
    role
  );
  return userId;
}

async function createTestResource(db, capacity = 2) {
  const resourceId = nanoid(8);
  await db.run(
    'INSERT INTO resources (id, name, capacity) VALUES (?, ?, ?)',
    resourceId,
    `Test Resource ${resourceId}`,
    capacity
  );
  return resourceId;
}

async function createTestSlot(db, resourceId, { start, end, blocked = false }) {
  const slotId = nanoid(10);
  await db.run(
    'INSERT INTO slots (id, resourceId, start, end, blocked) VALUES (?, ?, ?, ?, ?)',
    slotId,
    resourceId,
    start.toISOString(),
    end.toISOString(),
    blocked
  );
  return slotId;
}

// Clean up helper
async function cleanup(db) {
  await db.exec(`
    DELETE FROM bookings;
    DELETE FROM slots;
    DELETE FROM resources;
    DELETE FROM users;
    DELETE FROM recurringRules;
    DELETE FROM blackoutDates;
    DELETE FROM auditLog;
  `);
}

// Test suites
test('booking constraints', async (t) => {
  const db = await initDB();
  
  await t.test('prevents double booking', async () => {
    await cleanup(db);
    
    const userId = await createTestUser(db);
    const resourceId = await createTestResource(db);
    const start = new Date();
    start.setHours(start.getHours() + 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 2);
    
    const slotId = await createTestSlot(db, resourceId, { start, end });
    
    // First booking should succeed
    const result1 = await bookSlot(userId, slotId);
    assert.equal(result1.status, 'confirmed');
    
    // Second booking should fail
    await assert.rejects(
      () => bookSlot(userId, slotId),
      { code: 'ALREADY_BOOKED' }
    );
  });
  
  await t.test('respects capacity limits', async () => {
    await cleanup(db);
    
    const resourceId = await createTestResource(db, 2);
    const start = new Date();
    start.setHours(start.getHours() + 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 2);
    
    const slotId = await createTestSlot(db, resourceId, { start, end });
    const user1 = await createTestUser(db);
    const user2 = await createTestUser(db);
    const user3 = await createTestUser(db);
    
    // First two bookings should be confirmed
    const result1 = await bookSlot(user1, slotId);
    assert.equal(result1.status, 'confirmed');
    
    const result2 = await bookSlot(user2, slotId);
    assert.equal(result2.status, 'confirmed');
    
    // Third booking should go to waitlist
    const result3 = await bookSlot(user3, slotId);
    assert.equal(result3.status, 'waitlisted');
    assert.equal(result3.position, 1);
  });
});

test('overlap prevention', async (t) => {
  const db = await initDB();
  
  await t.test('prevents overlapping bookings', async () => {
    await cleanup(db);
    
    const userId = await createTestUser(db);
    const resourceId = await createTestResource(db);
    
    const start1 = new Date();
    start1.setHours(start1.getHours() + 1);
    const end1 = new Date(start1);
    end1.setHours(end1.getHours() + 2);
    
    const start2 = new Date(start1);
    start2.setMinutes(start2.getMinutes() + 30);
    const end2 = new Date(end1);
    end2.setMinutes(end2.getMinutes() + 30);
    
    const slot1 = await createTestSlot(db, resourceId, { start: start1, end: end1 });
    const slot2 = await createTestSlot(db, resourceId, { start: start2, end: end2 });
    
    // Book first slot
    await bookSlot(userId, slot1);
    
    // Trying to book overlapping slot should fail
    await assert.rejects(
      () => bookSlot(userId, slot2),
      { code: 'OVERLAP_CONFLICT' }
    );
  });
});

test('waitlist behavior', async (t) => {
  const db = await initDB();
  
  await t.test('promotes from waitlist on cancellation', async () => {
    await cleanup(db);
    
    const resourceId = await createTestResource(db, 1);
    const start = new Date();
    start.setHours(start.getHours() + 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 2);
    
    const slotId = await createTestSlot(db, resourceId, { start, end });
    
    const user1 = await createTestUser(db);
    const user2 = await createTestUser(db);
    
    // Book slot to capacity
    const booking1 = await bookSlot(user1, slotId);
    assert.equal(booking1.status, 'confirmed');
    
    // Second user goes to waitlist
    const booking2 = await bookSlot(user2, slotId);
    assert.equal(booking2.status, 'waitlisted');
    
    // Cancel first booking
    await cancelBooking(booking1.bookingId, user1);
    
    // Check that second user was promoted
    const status = await db.get(
      'SELECT status FROM bookings WHERE userId = ? AND slotId = ?',
      user2, slotId
    );
    assert.equal(status.status, 'confirmed');
  });
  
  await t.test('maintains waitlist order', async () => {
    await cleanup(db);
    
    const resourceId = await createTestResource(db, 1);
    const start = new Date();
    start.setHours(start.getHours() + 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 2);
    
    const slotId = await createTestSlot(db, resourceId, { start, end });
    
    const users = await Promise.all([
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
      createTestUser(db)
    ]);
    
    // Book slot and fill waitlist
    await bookSlot(users[0], slotId);
    const wait1 = await bookSlot(users[1], slotId);
    const wait2 = await bookSlot(users[2], slotId);
    const wait3 = await bookSlot(users[3], slotId);
    
    assert.equal(wait1.position, 1);
    assert.equal(wait2.position, 2);
    assert.equal(wait3.position, 3);
    
    // Cancel first waitlisted user
    await cancelBooking(wait1.bookingId, users[1]);
    
    // Check positions were reindexed
    const positions = await db.all(
      `SELECT userId, waitlistPosition 
       FROM bookings 
       WHERE slotId = ? AND status = 'waitlisted'
       ORDER BY waitlistPosition`,
      slotId
    );
    
    assert.equal(positions.length, 2);
    assert.equal(positions[0].waitlistPosition, 1);
    assert.equal(positions[1].waitlistPosition, 2);
  });
});

test('grace period', async (t) => {
  const db = await initDB();
  
  await t.test('prevents last-minute cancellation', async () => {
    await cleanup(db);
    
    const resourceId = await createTestResource(db);
    const start = new Date();
    start.setMinutes(start.getMinutes() + 3); // Just inside grace period
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    
    const slotId = await createTestSlot(db, resourceId, { start, end });
    const userId = await createTestUser(db);
    
    const booking = await bookSlot(userId, slotId);
    
    // Try to cancel within grace period
    await assert.rejects(
      () => cancelBooking(booking.bookingId, userId),
      { code: 'GRACE_PERIOD' }
    );
  });
});