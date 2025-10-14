import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { nanoid } from 'nanoid';
import { initDB } from '../db.js';
import app from '../app.js';

// Test data helpers
async function createTestUser(db, role = 'STUDENT') {
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

test('RBAC - Resource Management', async (t) => {
  const db = await initDB();
  
  await t.test('resource creation permissions', async () => {
    await cleanup(db);
    
    const admin = await createTestUser(db, 'ADMIN');
    const student = await createTestUser(db, 'STUDENT');
    const ta = await createTestUser(db, 'TA');
    
    // Student cannot create resource
    const studentRes = await request(app)
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${student.token}`)
      .send({ name: 'Test Lab', capacity: 10 });
    
    assert.equal(studentRes.status, 403);
    assert.equal(studentRes.body.code, 'FORBIDDEN');
    
    // TA cannot create resource
    const taRes = await request(app)
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${ta.token}`)
      .send({ name: 'Test Lab', capacity: 10 });
    
    assert.equal(taRes.status, 403);
    assert.equal(taRes.body.code, 'FORBIDDEN');
    
    // Admin can create resource
    const adminRes = await request(app)
      .post('/api/admin/resources')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Test Lab', capacity: 10 });
    
    assert.equal(adminRes.status, 200);
    assert.ok(adminRes.body.id);
  });
});

test('RBAC - Analytics Access', async (t) => {
  const db = await initDB();
  
  await t.test('analytics access control', async () => {
    await cleanup(db);
    
    const admin = await createTestUser(db, 'ADMIN');
    const student = await createTestUser(db, 'STUDENT');
    
    // Create some test data
    const resource = await createTestResource(db);
    await createTestBookings(db, resource.id);
    
    // Student cannot access analytics
    const studentRes = await request(app)
      .get('/api/analytics/resources')
      .set('Authorization', `Bearer ${student.token}`);
    
    assert.equal(studentRes.status, 403);
    assert.equal(studentRes.body.code, 'FORBIDDEN');
    
    // Admin can access analytics
    const adminRes = await request(app)
      .get('/api/analytics/resources')
      .set('Authorization', `Bearer ${admin.token}`);
    
    assert.equal(adminRes.status, 200);
    assert.ok(Array.isArray(adminRes.body));
  });
});

test('RBAC - Booking Access (Regression)', async (t) => {
  const db = await initDB();
  
  await t.test('students can still book slots', async () => {
    await cleanup(db);
    
    const student = await createTestUser(db, 'STUDENT');
    const admin = await createTestUser(db, 'ADMIN');
    
    // Admin creates resource
    const resource = await createTestResource(db, admin);
    
    // Generate slots (admin only)
    const slotsRes = await request(app)
      .post('/api/admin/slots/generate')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        resourceId: resource.id,
        startDate: new Date().toISOString(),
        days: 7
      });
    
    assert.equal(slotsRes.status, 200);
    
    // Student can view slots
    const viewRes = await request(app)
      .get(`/api/slots?resourceId=${resource.id}`)
      .set('Authorization', `Bearer ${student.token}`);
    
    assert.equal(viewRes.status, 200);
    assert.ok(Array.isArray(viewRes.body));
    
    // Student can book slot
    const bookRes = await request(app)
      .post('/api/book')
      .set('Authorization', `Bearer ${student.token}`)
      .send({
        slotId: viewRes.body[0].id,
        userId: student.id
      });
    
    assert.equal(bookRes.status, 200);
    assert.equal(bookRes.body.status, 'confirmed');
  });
});