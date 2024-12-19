import React, { useState } from 'react';
import Tabs from './Tabs';
import CodeEditor from './CodeEditor';
import Preview from './Preview';

interface ContentProps {
  selectedFile: { name: string; content: string } | null;
}

export default function Content({ selectedFile }: ContentProps) {
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');

  return (
    <div className="h-full flex flex-col">
      <Tabs activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1">
        {activeTab === 'code' ? (
          <CodeEditor file={selectedFile} />
        ) : (
          <Preview />
        )}
      </div>
    </div>
  );
}