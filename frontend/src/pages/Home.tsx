import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Code, Eye, Edit } from 'lucide-react';

const Home = () => {
  const [idea, setIdea] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (event:any) => {
    event.preventDefault();
    if (idea.trim()) {
      navigate('/workspace', { state: { prompt: idea } });
    }
  };

  const features = [
    {
      icon: <Code className="w-6 h-6" />,
      title: "Production-Ready Code",
      description: "Get fully functional code instantly from your ideas"
    },
    {
      icon: <Eye className="w-6 h-6" />,
      title: "Live Preview",
      description: "See your application come to life in real-time"
    },
    {
      icon: <Edit className="w-6 h-6" />,
      title: "Flexible Editing",
      description: "Edit via prompts or use the built-in code editor"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800">
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Sparkles className="w-8 h-8 text-blue-400" />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              BuilderMan
            </h1>
          </div>
          
          <p className="text-gray-300 text-xl mb-8 max-w-2xl mx-auto">
            Transform your ideas into reality with AI-powered development
          </p>

          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
            <div className="flex gap-4">
              <input
                type="text"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Describe what you want to build..."
                className="flex-1 px-6 py-4 rounded-xl bg-gray-800/50 border border-gray-700 text-gray-100 
                          placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-semibold
                          hover:opacity-90 transition-all duration-200 shadow-lg shadow-blue-500/25"
              >
                Build Now
              </button>
            </div>
          </form>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mb-16">
          {features.map((feature, index) => (
            <div key={index} className="bg-gray-800/50 backdrop-blur border border-gray-700/50 rounded-xl p-6
                                      hover:bg-gray-800 transition-colors duration-200">
              <div className="bg-blue-500/10 rounded-lg p-3 w-fit mb-4">
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold text-gray-100 mb-2">
                {feature.title}
              </h3>
              <p className="text-gray-400">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-8">
          <h2 className="text-2xl font-semibold text-gray-100 mb-6">Coming Soon</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 text-gray-400">
              <div className="w-2 h-2 rounded-full bg-blue-400"></div>
              Streaming Code Generation
            </div>
            <div className="flex items-center gap-3 text-gray-400">
              <div className="w-2 h-2 rounded-full bg-blue-400"></div>
              Code Export Functionality
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;