import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { initDB } from './db.js';

async function seed() {
  const db = await initDB();

  // Create test users
  const users = [
    { id: 'u1', name: 'Alice', email: 'alice@example.com', password: 'password', role: 'student' },
    { id: 'u2', name: 'Bob', email: 'bob@example.com', password: 'password', role: 'student' },
    { id: 'u3', name: 'Carol', email: 'carol@example.com', password: 'password', role: 'student' },
    { id: 'u4', name: 'TA Tim', email: 'ta@example.com', password: 'password', role: 'ta' },
    { id: 'u5', name: 'Admin Ada', email: 'admin@example.com', password: 'admin', role: 'admin' }
  ];

  for (const user of users) {
    try {
      await db.run(
        `INSERT INTO users (id, name, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)`,
        user.id, user.name, user.email, bcrypt.hashSync(user.password, 10), user.role
      );
    } catch (err) {
      if (!err.message.includes('UNIQUE constraint')) throw err;
    }
  }

  // Create test resources
  const resources = [
    { id: 'r1', name: 'Workstation A', capacity: 2 },
    { id: 'r2', name: 'Workstation B', capacity: 2 },
    { id: 'r3', name: '3D Printer', capacity: 1 }
  ];

  for (const resource of resources) {
    try {
      await db.run(
        `INSERT INTO resources (id, name, capacity) VALUES (?, ?, ?)`,
        resource.id, resource.name, resource.capacity
      );
    } catch (err) {
      if (!err.message.includes('UNIQUE constraint')) throw err;
    }
  }

  // Generate this week's slots
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Start from Monday

  const hours = [8, 10, 12, 14, 16, 18];
  for (const resource of resources) {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      for (const hour of hours) {
        const start = new Date(weekStart);
        start.setDate(start.getDate() + dayOffset);
        start.setHours(hour);
        const end = new Date(start);
        end.setHours(hour + 2);

        try {
          await db.run(
            `INSERT INTO slots (id, resourceId, start, end, blocked) VALUES (?, ?, ?, ?, ?)`,
            nanoid(10), resource.id, start.toISOString(), end.toISOString(), false
          );
        } catch (err) {
          if (!err.message.includes('UNIQUE constraint')) throw err;
        }
      }
    }
  }

  console.log('Database seeded successfully');
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  seed().catch(console.error);
}