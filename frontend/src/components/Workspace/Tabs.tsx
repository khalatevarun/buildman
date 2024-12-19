import React from 'react';
import { Code2, Eye } from 'lucide-react';

interface TabsProps {
  activeTab: 'code' | 'preview';
  onTabChange: (tab: 'code' | 'preview') => void;
}

export default function Tabs({ activeTab, onTabChange }: TabsProps) {
  return (
    <div className="flex border-b border-gray-700">
      <button
        className={`flex items-center gap-2 px-4 py-2 border-b-2 ${
          activeTab === 'code'
            ? 'text-blue-400 border-blue-400'
            : 'text-gray-400 border-transparent'
        } hover:text-blue-400`}
        onClick={() => onTabChange('code')}
      >
        <Code2 className="h-4 w-4" />
        Code
      </button>
      <button
        className={`flex items-center gap-2 px-4 py-2 border-b-2 ${
          activeTab === 'preview'
            ? 'text-blue-400 border-blue-400'
            : 'text-gray-400 border-transparent'
        } hover:text-blue-400`}
        onClick={() => onTabChange('preview')}
      >
        <Eye className="h-4 w-4" />
        Preview
      </button>
    </div>
  );
}