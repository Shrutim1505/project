import React, { useEffect, useMemo, useState } from 'react';
import Login from './Login.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function useSSE(onEvent) {
  useEffect(() => {
    const ev = new EventSource(`${API_URL}/api/events`);
    ev.addEventListener('booking_confirmed', e => onEvent('booking_confirmed', JSON.parse(e.data)));
    ev.addEventListener('waitlisted', e => onEvent('waitlisted', JSON.parse(e.data)));
    ev.addEventListener('promoted', e => onEvent('promoted', JSON.parse(e.data)));
    ev.addEventListener('slot_updated', e => onEvent('slot_updated', JSON.parse(e.data)));
    return () => ev.close();
  }, [onEvent]);
}

export default function App() {
  const [users, setUsers] = useState([]);
  const [resources, setResources] = useState([]);
  const [slots, setSlots] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    return token && user ? { token, user: JSON.parse(user) } : null;
  });
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [adminMode, setAdminMode] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/users`).then(r => r.json()).then(setUsers);
    fetch(`${API_URL}/api/resources`).then(r => r.json()).then(rs => {
      setResources(rs);
      if (rs[0]) setSelectedResourceId(rs[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedResourceId) return;
    
    // Fetch slots with computed status
    fetch(`${API_URL}/api/slots?resourceId=${selectedResourceId}`).then(r => r.json()).then(setSlots);

    // If admin/TA, also fetch recurring rules
    if (auth?.user?.role === 'admin' || auth?.user?.role === 'ta') {
      fetch(`${API_URL}/api/admin/rules?resourceId=${selectedResourceId}`)
        .then(r => r.ok ? r.json() : [])
        .then(rules => console.log('Recurring rules:', rules))
        .catch(console.error);
    }
  }, [selectedResourceId, auth?.user?.role]);

  useSSE((_event, data) => {
    if (selectedResourceId) {
      fetch(`${API_URL}/api/slots?resourceId=${selectedResourceId}`).then(r => r.json()).then(setSlots);
    }
  });

  const resourceById = useMemo(() => Object.fromEntries(resources.map(r => [r.id, r])), [resources]);

  async function book(slotId) {
    if (!selectedUserId) {
      alert('Select a user first');
      return;
    }
    const res = await fetch(`${API_URL}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUserId, slotId })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
  }

  async function cancel(slotId) {
    if (!selectedUserId) {
      alert('Select a user first');
      return;
    }
    const res = await fetch(`${API_URL}/api/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUserId, slotId })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
  }

  function userBadge(slot) {
    const isBooked = slot.bookings.includes(selectedUserId);
    const waitIdx = slot.waitlist.indexOf(selectedUserId);
    if (isBooked) return 'Booked';
    if (waitIdx >= 0) return `Waitlist #${waitIdx + 1}`;
    return 'Available';
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: '2-digit' });
  }

  const slotsByDay = useMemo(() => {
    const groups = {};
    for (const s of slots) {
      const d = new Date(s.start);
      const key = d.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => new Date(a.start) - new Date(b.start));
    }
    return groups;
  }, [slots]);

  return (
    <>
      <div className="navbar">
        <div className="navbar-inner">
          <div className="logo">
            <div className="logo-mark"></div>
            <div>Lab Resource Scheduler</div>
          </div>
          <div className="tabs" style={{ marginLeft: 16 }}>
            {auth?.user?.role === 'admin' && (
              <button className={`tab ${adminMode ? 'active' : ''}`} onClick={() => setAdminMode(!adminMode)}>
                {adminMode ? 'Close Admin' : ''}
              </button>
            )}
          </div>
          <div style={{ marginLeft: 'auto' }} className="legend">
            <span className="badge success">Booked</span>
            <span className="badge warn">Waitlist</span>
            <span className="badge info">Available</span>
            <button
              className="btn"
              onClick={() => {
                const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('theme', next);
              }}
              title="Toggle theme"
              style={{ marginLeft: 8 }}
            >
              <span className="icon">🌓</span>
            </button>
          </div>
          <div className="tabs" style={{ marginLeft: 12 }}>
            {auth ? (
              <>
                <span className="badge info">{auth.user.name} ({auth.user.role})</span>
                <button className="tab" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); setAuth(null); setSelectedUserId(''); }}>Logout</button>
              </>
            ) : (
              <>
                <button className="tab" onClick={async () => {
                  const email = prompt('Email');
                  const password = prompt('Password');
                  if (!email || !password) return;
                  const res = await fetch(`${API_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
                  const data = await res.json();
                  if (!res.ok || data.error) { alert(data.error || 'Login failed'); return; }
                  localStorage.setItem('token', data.token);
                  localStorage.setItem('user', JSON.stringify(data.user));
                  setAuth({ token: data.token, user: data.user });
                  setSelectedUserId(data.user.id);
                }}>Login</button>
                <button className="tab" onClick={async () => {
                  const name = prompt('Name');
                  const email = prompt('Email');
                  const password = prompt('Password');
                  if (!name || !email || !password) return;
                  const res = await fetch(`${API_URL}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
                  const data = await res.json();
                  if (!res.ok || data.error) { alert(data.error || 'Register failed'); return; }
                  localStorage.setItem('token', data.token);
                  localStorage.setItem('user', JSON.stringify(data.user));
                  setAuth({ token: data.token, user: data.user });
                  setSelectedUserId(data.user.id);
                }}>Register</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="app-container">
        {!auth ? (
          <Login
            onLogin={(a) => {
              setAuth(a);
              setSelectedUserId(a.user.id);
            }}
          />
        ) : adminMode ? (
          <div>
            <h3>Admin Panel</h3>

            <div className="controls" style={{ marginBottom: 12 }}>
              <div className="control">
                <span>Add Equipment</span>
                <button
                  className="btn primary"
                  onClick={async () => {
                    const name = prompt('Equipment name');
                    if (!name) return;
                    const capacityStr = prompt('Capacity (number of units)', '1');
                    const capacity = Number(capacityStr || '1');
                    const res = await fetch(`${API_URL}/api/admin/resources`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name, capacity })
                    });
                    if (!res.ok) {
                      alert('Failed');
                      return;
                    }
                    const r = await res.json();
                    alert('Added: ' + r.name);
                    const rs = await fetch(`${API_URL}/api/resources`).then(r => r.json());
                    setResources(rs);
                    if (selectedResourceId) {
                      fetch(`${API_URL}/api/slots?resourceId=${selectedResourceId}`).then(r => r.json()).then(setSlots);
                    }
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            <div className="controls" style={{ marginBottom: 12 }}>
              <div className="control">
                <span>Recurring Rule</span>
                <button
                  className="btn"
                  onClick={async () => {
                    const resourceId = prompt('Resource ID (e.g., r1)');
                    const dayOfWeek = Number(prompt('Day of week (Mon=1..Sun=7)', '1'));
                    const startHour = Number(prompt('Start hour (24h)', '10'));
                    const endHour = Number(prompt('End hour (24h)', '12'));
                    const label = prompt('Label', 'Class');
                    if (!resourceId) return;
                    const res = await fetch(`${API_URL}/api/admin/rules`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ resourceId, dayOfWeek, startHour, endHour, label })
                    });
                    if (!res.ok) {
                      alert('Failed');
                      return;
                    }
                    alert('Rule added');
                    if (selectedResourceId) {
                      fetch(`${API_URL}/api/slots?resourceId=${selectedResourceId}`).then(r => r.json()).then(setSlots);
                    }
                  }}
                >
                  + Add Rule
                </button>
              </div>
            </div>

            <div className="controls">
              <div className="control">
                <span>Usage</span>
                <button
                  className="btn"
                  onClick={async () => {
                    const stats = await fetch(`${API_URL}/api/admin/stats`).then(r => r.json());
                    console.log(stats);
                    alert('Check console for stats');
                  }}
                >
                  View Stats
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="header">
              <div className="title"></div>
              <div className="legend"></div>
            </div>

            <div className="toolbar">
              <div className="controls">
                <div className="control">
                  <span>User</span>
                  <select className="select" value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
                    <option value="">Select...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="control" style={{ flex: 1 }}>
                  <span>Resource</span>
                  <div className="tabs">
                    {resources.map(r => (
                      <button
                        key={r.id}
                        className={`tab ${selectedResourceId === r.id ? 'active' : ''}`}
                        onClick={() => setSelectedResourceId(r.id)}
                      >
                        {r.name} (cap {r.capacity})
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="days">
              {Object.keys(slotsByDay).map(day => (
                <div className="day-card" key={day}>
                  <div className="day-header">
                    <div className="day-title">{day}</div>
                    <div className="counts">
                      <span className="count">Slots {slotsByDay[day].length}</span>
                    </div>
                  </div>

                  <table className="day-table">
                    <thead>
                      <tr>
                        <th>Start</th>
                        <th>End</th>
                        <th>Booked</th>
                        <th>Waitlist</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {slotsByDay[day].map(slot => {
                        const isBooked = slot.bookings.includes(selectedUserId);
                        const waitIdx = slot.waitlist.indexOf(selectedUserId);
                        const badgeClass = slot.blocked
                          ? 'pill wait'
                          : isBooked
                          ? 'pill booked'
                          : waitIdx >= 0
                          ? 'pill wait'
                          : 'pill avail';
                        const cap = resourceById[slot.resourceId]?.capacity ?? 0;
                        const booked = slot.bookings.length;
                        const percent = cap > 0 ? Math.round((booked / cap) * 100) : 0;

                        return (
                          <tr key={slot.id}>
                            <td>{formatTime(slot.start)}</td>
                            <td>{formatTime(slot.end)}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                <div className="progress">
                                  <div className="progress-bar" style={{ width: `${percent}%` }} />
                                </div>
                                <span className="progress-text">
                                  {booked} / {cap}
                                </span>
                              </div>
                            </td>
                            <td>{slot.blocked ? slot.blockedLabel || 'Blocked' : slot.waitlist.length}</td>
                            <td>
                              <div className="actions">
                                <span className={badgeClass}>{userBadge(slot)}</span>
                                <button className="btn primary" onClick={() => book(slot.id)} title="Book" disabled={slot.blocked}>
                                  <span className="icon">➕</span> Book
                                </button>
                                <button
                                  className="btn danger"
                                  onClick={() => cancel(slot.id)}
                                  title="Cancel"
                                  disabled={slot.blocked && !isBooked}
                                >
                                  <span className="icon">✖</span> Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
