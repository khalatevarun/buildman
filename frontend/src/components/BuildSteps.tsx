import React from 'react';
import { PlayCircle } from 'lucide-react';

interface Step {
  id: number;
  title: string;
  status: 'completed' | 'in-progress' | 'pending';
}

export default function BuildSteps() {
  const steps: Step[] = [
    { id: 1, title: 'Initialize Project', status: 'completed' },
    { id: 2, title: 'Create File Structure', status: 'in-progress' },
    { id: 3, title: 'Generate Components', status: 'pending' },
    { id: 4, title: 'Add Styling', status: 'pending' },
    { id: 5, title: 'Implement Features', status: 'pending' },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
        <PlayCircle className="h-5 w-5 text-blue-400" />
        Build Steps
      </h2>
      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.id}
            className={`p-3 rounded-lg ${
              step.status === 'completed'
                ? 'bg-green-900/50 text-green-200'
                : step.status === 'in-progress'
                ? 'bg-blue-900/50 text-blue-200'
                : 'bg-gray-800 text-gray-300'
            }`}
          >
            {step.title}
          </div>
        ))}
      </div>
    </div>
  );
}