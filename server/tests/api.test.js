import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { nanoid } from 'nanoid';
import { initDB } from '../db.js';
import app from '../app.js'; // We'll create this next

// Test JWT helper
function createTestToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

// Test data helpers
async function createTestUser(db, role = 'student') {
  const id = nanoid(8);
  const user = {
    id,
    name: `Test ${role} ${id}`,
    email: `test-${id}@example.com`,
    role
  };
  
  await db.run(
    'INSERT INTO users (id, name, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)',
    user.id, user.name, user.email, 'hash', user.role
  );
  
  user.token = createTestToken(user);
  return user;
}

async function createTestResource(db, capacity = 2) {
  const id = nanoid(8);
  await db.run(
    'INSERT INTO resources (id, name, capacity) VALUES (?, ?, ?)',
    id, `Test Resource ${id}`, capacity
  );
  return id;
}

// Clean database between tests
async function cleanup(db) {
  await db.exec(`
    DELETE FROM bookings;
    DELETE FROM slots;
    DELETE FROM resources;
    DELETE FROM users;
    DELETE FROM auditLog;
  `);
}

test('API integration - booking flow', async (t) => {
  const db = await initDB();
  
  await t.test('full booking flow', async () => {
    await cleanup(db);
    
    // Create test users
    const student1 = await createTestUser(db, 'student');
    const student2 = await createTestUser(db, 'student');
    const admin = await createTestUser(db, 'admin');
    
    // Admin creates resource
    const resourceRes = await request(app)
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        name: 'Test Resource',
        capacity: 1
      });
    
    assert.equal(resourceRes.status, 200);
    const resourceId = resourceRes.body.id;
    
    // Get available slots
    const slotsRes = await request(app)
      .get(`/api/slots?resourceId=${resourceId}`)
      .set('Authorization', `Bearer ${student1.token}`);
    
    assert.equal(slotsRes.status, 200);
    assert.ok(Array.isArray(slotsRes.body));
    const slot = slotsRes.body[0];
    
    // Student 1 books slot
    const book1Res = await request(app)
      .post('/api/book')
      .set('Authorization', `Bearer ${student1.token}`)
      .send({
        slotId: slot.id,
        userId: student1.id
      });
    
    assert.equal(book1Res.status, 200);
    assert.equal(book1Res.body.status, 'confirmed');
    
    // Student 2 tries to book same slot (should go to waitlist)
    const book2Res = await request(app)
      .post('/api/book')
      .set('Authorization', `Bearer ${student2.token}`)
      .send({
        slotId: slot.id,
        userId: student2.id
      });
    
    assert.equal(book2Res.status, 200);
    assert.equal(book2Res.body.status, 'waitlisted');
    assert.equal(book2Res.body.position, 1);
    
    // Check slot status
    const statusRes = await request(app)
      .get(`/api/slots/${slot.id}/status`)
      .set('Authorization', `Bearer ${student1.token}`);
    
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.confirmedCount, 1);
    assert.equal(statusRes.body.waitlistCount, 1);
    
    // Student 1 cancels booking
    const cancelRes = await request(app)
      .post('/api/cancel')
      .set('Authorization', `Bearer ${student1.token}`)
      .send({
        bookingId: book1Res.body.bookingId,
        actorId: student1.id
      });
    
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.status, 'cancelled');
    
    // Verify Student 2 was promoted
    const finalStatus = await request(app)
      .get(`/api/slots/${slot.id}/status`)
      .set('Authorization', `Bearer ${student2.token}`);
    
    assert.equal(finalStatus.status, 200);
    assert.equal(finalStatus.body.confirmedCount, 1);
    assert.equal(finalStatus.body.waitlistCount, 0);
  });
});

test('API integration - admin controls', async (t) => {
  const db = await initDB();
  
  await t.test('role-based access control', async () => {
    await cleanup(db);
    
    const student = await createTestUser(db, 'student');
    const ta = await createTestUser(db, 'ta');
    const admin = await createTestUser(db, 'admin');
    
    // Student cannot create resources
    const studentRes = await request(app)
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${student.token}`)
      .send({
        name: 'Test Resource',
        capacity: 1
      });
    
    assert.equal(studentRes.status, 403);
    
    // TA cannot create resources
    const taRes = await request(app)
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${ta.token}`)
      .send({
        name: 'Test Resource',
        capacity: 1
      });
    
    assert.equal(taRes.status, 403);
    
    // Admin can create resources
    const adminRes = await request(app)
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        name: 'Test Resource',
        capacity: 1
      });
    
    assert.equal(adminRes.status, 200);
    assert.ok(adminRes.body.id);
    
    // TA can view rules
    const rulesRes = await request(app)
      .get('/api/admin/rules')
      .set('Authorization', `Bearer ${ta.token}`);
    
    assert.equal(rulesRes.status, 200);
  });
  
  await t.test('recurring rules', async () => {
    await cleanup(db);
    
    const admin = await createTestUser(db, 'admin');
    
    // Create resource
    const resourceRes = await request(app)
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        name: 'Test Resource',
        capacity: 1
      });
    
    const resourceId = resourceRes.body.id;
    
    // Create recurring rule
    const ruleRes = await request(app)
      .post('/api/admin/rules')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        resourceId,
        dayOfWeek: 2, // Tuesday
        startHour: 10,
        endHour: 12,
        label: 'Weekly Meeting'
      });
    
    assert.equal(ruleRes.status, 200);
    assert.ok(ruleRes.body.id);
    
    // Verify slots are blocked
    const slotsRes = await request(app)
      .get(`/api/slots?resourceId=${resourceId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    
    const blockedSlot = slotsRes.body.find(s => {
      const d = new Date(s.start);
      return d.getDay() === 2 && d.getHours() === 10;
    });
    
    assert.ok(blockedSlot);
    assert.equal(blockedSlot.blocked, true);
    assert.equal(blockedSlot.blockedLabel, 'Weekly Meeting');
  });
});