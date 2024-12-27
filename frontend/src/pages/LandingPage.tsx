import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wand2 } from 'lucide-react';

export default function LandingPage() {
  const [prompt, setPrompt] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      navigate('/workspace', { state: { prompt } });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex flex-col items-center justify-center p-4">
      <div className="max-w-3xl w-full text-center space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-center">
            <Wand2 className="h-12 w-12 text-blue-400" />
          </div>
          <h1 className="text-4xl font-bold text-gray-100">
            Create Your Dream Website
          </h1>
          <p className="text-xl text-gray-300">
            Describe your website and let AI build it for you
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="max-w-2xl mx-auto">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your website (e.g., 'Create a modern portfolio website with a dark theme, project gallery, and contact form')"
              className="w-full h-32 p-4 text-gray-100 bg-gray-800 rounded-lg shadow-sm border border-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none placeholder-gray-500"
            />
          </div>
          <button
            type="submit"
            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Generate Website
          </button>
        </form>
      </div>
    </div>
  );
}