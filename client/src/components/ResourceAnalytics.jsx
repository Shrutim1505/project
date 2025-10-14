import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { fetchWithAuth } from '../utils/api';

export function ResourceAnalytics({ resourceId }) {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user.role !== 'ADMIN') return;

    const fetchAnalytics = async () => {
      try {
        const data = await fetchWithAuth(`/api/analytics/resource/${resourceId}`);
        setAnalytics(data);
      } catch (err) {
        console.error('Analytics error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [resourceId, user]);

  if (user.role !== 'ADMIN') return null;
  if (loading) return <div>Loading analytics...</div>;
  if (error) return <div>Error loading analytics: {error}</div>;
  if (!analytics) return null;

  return (
    <div className="analytics-panel p-4 bg-white rounded-lg shadow mt-4">
      <h3 className="text-lg font-semibold mb-4">Resource Analytics</h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card p-3 bg-blue-50 rounded">
          <div className="text-sm text-gray-600">Total Bookings</div>
          <div className="text-2xl font-bold">{analytics.totalBookings}</div>
        </div>
        
        <div className="stat-card p-3 bg-green-50 rounded">
          <div className="text-sm text-gray-600">Confirmed</div>
          <div className="text-2xl font-bold">{analytics.confirmedBookings}</div>
        </div>
        
        <div className="stat-card p-3 bg-yellow-50 rounded">
          <div className="text-sm text-gray-600">Waitlisted</div>
          <div className="text-2xl font-bold">{analytics.waitlistedBookings}</div>
        </div>
        
        <div className="stat-card p-3 bg-purple-50 rounded">
          <div className="text-sm text-gray-600">Utilization</div>
          <div className="text-2xl font-bold">
            {(analytics.utilization * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {analytics.waitlistedBookings > 0 && (
        <div className="mt-4">
          <h4 className="font-medium mb-2">Waitlist Distribution</h4>
          <div className="h-4 bg-gray-200 rounded overflow-hidden">
            <div 
              className="h-full bg-yellow-400"
              style={{ 
                width: `${(analytics.waitlistedBookings / analytics.totalBookings) * 100}%`
              }}
            />
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {((analytics.waitlistedBookings / analytics.totalBookings) * 100).toFixed(1)}% of bookings are waitlisted
          </div>
        </div>
      )}
    </div>
  );
}