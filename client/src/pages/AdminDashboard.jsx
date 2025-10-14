import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { fetchWithAuth } from '../utils/api';
import { withRole } from '../hooks/useAuth';

function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [resources, setResources] = useState([]);
  const [globalStats, setGlobalStats] = useState(null);
  const [newResource, setNewResource] = useState({ name: '', capacity: '' });

  useEffect(() => {
    fetchResources();
    fetchGlobalStats();
  }, []);

  const fetchResources = async () => {
    try {
      const data = await fetchWithAuth('/api/admin/resources');
      setResources(data);
    } catch (err) {
      console.error('Error fetching resources:', err);
    }
  };

  const fetchGlobalStats = async () => {
    try {
      const data = await fetchWithAuth('/api/analytics/resources');
      setGlobalStats(data);
    } catch (err) {
      console.error('Error fetching global stats:', err);
    }
  };

  const handleCreateResource = async (e) => {
    e.preventDefault();
    try {
      await fetchWithAuth('/api/admin/resources', {
        method: 'POST',
        body: JSON.stringify(newResource)
      });
      
      setNewResource({ name: '', capacity: '' });
      fetchResources();
    } catch (err) {
      console.error('Error creating resource:', err);
    }
  };

  const generateWeekSlots = async (resourceId) => {
    try {
      await fetchWithAuth('/api/admin/slots/generate', {
        method: 'POST',
        body: JSON.stringify({
          resourceId,
          startDate: new Date().toISOString(),
          days: 7
        })
      });
    } catch (err) {
      console.error('Error generating slots:', err);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-8">Admin Dashboard</h1>
      
      {/* Global Stats */}
      {globalStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-2">Total Resources</h3>
            <p className="text-3xl font-bold">{globalStats.totalResources}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-2">Active Bookings</h3>
            <p className="text-3xl font-bold">{globalStats.activeBookings}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-2">Total Waitlisted</h3>
            <p className="text-3xl font-bold">{globalStats.totalWaitlisted}</p>
          </div>
        </div>
      )}

      {/* Create New Resource */}
      <div className="bg-white p-6 rounded-lg shadow mb-8">
        <h2 className="text-xl font-semibold mb-4">Create New Resource</h2>
        <form onSubmit={handleCreateResource} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Resource Name
            </label>
            <input
              type="text"
              value={newResource.name}
              onChange={e => setNewResource(prev => ({ ...prev, name: e.target.value }))}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Capacity
            </label>
            <input
              type="number"
              value={newResource.capacity}
              onChange={e => setNewResource(prev => ({ ...prev, capacity: e.target.value }))}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              required
              min="1"
            />
          </div>
          <button
            type="submit"
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Create Resource
          </button>
        </form>
      </div>

      {/* Resource List */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Resources</h2>
        <div className="space-y-4">
          {resources.map(resource => (
            <div key={resource.id} className="border p-4 rounded">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-semibold">{resource.name}</h3>
                  <p className="text-sm text-gray-600">Capacity: {resource.capacity}</p>
                </div>
                <div className="space-x-2">
                  <button
                    onClick={() => generateWeekSlots(resource.id)}
                    className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600"
                  >
                    Generate Week Slots
                  </button>
                  <button
                    onClick={() => navigate(`/resources/${resource.id}`)}
                    className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600"
                  >
                    View Details
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Wrap with role guard
export default withRole(['ADMIN'])(AdminDashboard);