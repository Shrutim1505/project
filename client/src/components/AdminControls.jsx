import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { fetchWithAuth } from '../utils/api';

export function AdminControls({ resourceId, onUpdate }) {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [capacity, setCapacity] = useState('');
  const [blackoutDate, setBlackoutDate] = useState('');

  if (user.role !== 'ADMIN') {
    return null;
  }

  const handleCapacityChange = async () => {
    try {
      await fetchWithAuth(`/api/admin/resources/${resourceId}/capacity`, {
        method: 'PATCH',
        body: JSON.stringify({ capacity: parseInt(capacity) })
      });
      
      setIsEditing(false);
      onUpdate?.();
    } catch (err) {
      console.error('Failed to update capacity:', err);
    }
  };

  const handleAddBlackout = async () => {
    try {
      await fetchWithAuth(`/api/admin/blackouts`, {
        method: 'POST',
        body: JSON.stringify({ 
          resourceId,
          date: blackoutDate,
        })
      });
      
      setBlackoutDate('');
      onUpdate?.();
    } catch (err) {
      console.error('Failed to add blackout:', err);
    }
  };

  const handleDeleteResource = async () => {
    if (!window.confirm('Are you sure you want to delete this resource?')) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/resources/${resourceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      });

      if (!res.ok) throw new Error('Failed to delete resource');
      
      onUpdate?.();
    } catch (err) {
      console.error('Failed to delete resource:', err);
    }
  };

  return (
    <div className="admin-controls p-4 bg-gray-50 rounded-lg mt-4 border border-gray-200">
      <h3 className="text-lg font-semibold mb-4">Admin Controls</h3>
      
      <div className="space-y-4">
        {/* Capacity Control */}
        <div>
          <h4 className="font-medium mb-2">Modify Capacity</h4>
          {isEditing ? (
            <div className="flex gap-2">
              <input
                type="number"
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                className="px-3 py-2 border rounded"
                min="1"
                placeholder="New capacity"
              />
              <button
                onClick={handleCapacityChange}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Save
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Change Capacity
            </button>
          )}
        </div>

        {/* Blackout Control */}
        <div>
          <h4 className="font-medium mb-2">Add Blackout Date</h4>
          <div className="flex gap-2">
            <input
              type="date"
              value={blackoutDate}
              onChange={e => setBlackoutDate(e.target.value)}
              className="px-3 py-2 border rounded"
            />
            <button
              onClick={handleAddBlackout}
              disabled={!blackoutDate}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300"
            >
              Add Blackout
            </button>
          </div>
        </div>

        {/* Delete Resource */}
        <div>
          <h4 className="font-medium mb-2">Danger Zone</h4>
          <button
            onClick={handleDeleteResource}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Delete Resource
          </button>
        </div>
      </div>
    </div>
  );
}