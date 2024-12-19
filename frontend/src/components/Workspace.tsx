import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import BuildSteps from './BuildSteps';
import FileExplorer from './FileExplorer/FileExplorer';
import Content from './Workspace/Content';

export default function Workspace() {
  const location = useLocation();
  const { prompt } = location.state || { prompt: '' };
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);

  return (
    <div className="h-screen flex bg-gray-900">
      {/* Left Sidebar - Steps */}
      <div className="w-64 bg-gray-900 border-r border-gray-700 p-4 overflow-y-auto">
        <BuildSteps />
      </div>

      {/* File Explorer */}
      <div className="w-64 border-r border-gray-700">
        <FileExplorer onFileSelect={setSelectedFile} />
      </div>

      {/* Content Area */}
      <div className="flex-1">
        <Content selectedFile={selectedFile} />
      </div>
    </div>
  );
}