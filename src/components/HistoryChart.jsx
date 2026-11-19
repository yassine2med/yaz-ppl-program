import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function HistoryChart({ log, days }) {
  const chartData = useMemo(() => {
    // We want to extract max weight per day for "Leg Press", "Nautilus Chest Press", "Nautilus Lat Pulldown"
    const targetExercises = ["Leg Press", "Nautilus Chest Press", "Nautilus Lat Pulldown", "Goblet Squat", "Dumbbell Romanian Deadlift"];
    
    // Create a mapping from prefix to exercise name
    const prefixToName = {};
    days.forEach(d => {
      d.exercises.forEach((ex, i) => {
        prefixToName[`${d.day}-${i}`] = ex.name;
      });
    });

    const dataByDate = {};

    Object.keys(log).forEach(sessionKey => {
      // sessionKey looks like "Monday-2023-10-01"
      const dateMatch = sessionKey.match(/\d{4}-\d{2}-\d{2}/);
      if (!dateMatch) return;
      const dateStr = dateMatch[0];
      
      const session = log[sessionKey];
      if (!dataByDate[dateStr]) {
        dataByDate[dateStr] = { date: dateStr };
      }

      Object.keys(session).forEach(key => {
        // key looks like "Monday-0" or "Monday-0-s1"
        const exKeyMatch = key.match(/^(Monday|Wednesday|Friday)-\d+/);
        if (exKeyMatch) {
          const exKey = exKeyMatch[0];
          const exName = prefixToName[exKey];
          if (targetExercises.includes(exName)) {
            // Check if this is a set entry like `session[exKey][si]` which contains {kg: 'x'}
            const setsData = session[exKey];
            if (setsData && typeof setsData === 'object') {
              let maxKg = 0;
              Object.values(setsData).forEach(set => {
                const kg = parseFloat(set.kg);
                if (!isNaN(kg) && kg > maxKg) maxKg = kg;
              });
              
              if (maxKg > 0) {
                if (!dataByDate[dateStr][exName] || maxKg > dataByDate[dateStr][exName]) {
                  dataByDate[dateStr][exName] = maxKg;
                }
              }
            }
          }
        }
      });
    });

    return Object.values(dataByDate).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [log, days]);

  if (chartData.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
        No chart data available yet. Start logging some heavy sets!
      </div>
    );
  }

  return (
    <div style={{ height: 300, width: '100%', marginTop: 24, background: 'var(--bg-card)', padding: '20px 10px 10px 0', borderRadius: 12, border: '1px solid var(--border-color)' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color-light)" vertical={false} />
          <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={11} tickFormatter={(val) => val.slice(5)} />
          <YAxis stroke="var(--text-secondary)" fontSize={11} width={30} />
          <Tooltip 
            contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)' }}
            itemStyle={{ fontSize: 12, fontWeight: 600 }}
          />
          <Line type="monotone" dataKey="Leg Press" stroke="#8B5CF6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          <Line type="monotone" dataKey="Nautilus Chest Press" stroke="#FF4B4B" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          <Line type="monotone" dataKey="Nautilus Lat Pulldown" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          <Line type="monotone" dataKey="Dumbbell Romanian Deadlift" stroke="#10B981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          <Line type="monotone" dataKey="Goblet Squat" stroke="#F59E0B" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
