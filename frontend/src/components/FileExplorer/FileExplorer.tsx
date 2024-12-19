import React, { useState } from 'react';
import { FolderTree } from 'lucide-react';
import FileItem from './FileItem';

interface FileNode {
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
}

interface FileExplorerProps {
  onFileSelect: (file: { name: string; content: string }) => void;
}

export default function FileExplorer({ onFileSelect }: FileExplorerProps) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set(['/']));

  const fileStructure: FileNode[] = [
    {
      name: 'src',
      type: 'folder',
      children: [
        {
          name: 'components',
          type: 'folder',
          children: [
            {
              name: 'App.tsx',
              type: 'file',
              content: '// App.tsx content here...'
            },
            {
              name: 'LandingPage.tsx',
              type: 'file',
              content: '// LandingPage.tsx content here...'
            }
          ]
        },
        {
          name: 'utils',
          type: 'folder',
          children: [
            {
              name: 'helpers.ts',
              type: 'file',
              content: '// Helper functions...'
            }
          ]
        }
      ]
    }
  ];

  const toggleFolder = (path: string) => {
    const newOpenFolders = new Set(openFolders);
    if (newOpenFolders.has(path)) {
      newOpenFolders.delete(path);
    } else {
      newOpenFolders.add(path);
    }
    setOpenFolders(newOpenFolders);
  };

  const renderFileTree = (nodes: FileNode[], path = '') => {
    return nodes.map((node) => {
      const currentPath = `${path}/${node.name}`;
      const isOpen = openFolders.has(currentPath);

      return (
        <div key={currentPath}>
          <FileItem
            name={node.name}
            type={node.type}
            level={currentPath.split('/').length - 1}
            isOpen={isOpen}
            onToggle={() => toggleFolder(currentPath)}
            onSelect={() => node.type === 'file' && node.content && onFileSelect({
              name: node.name,
              content: node.content
            })}
          />
          {node.type === 'folder' && isOpen && node.children && (
            <div>{renderFileTree(node.children, currentPath)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
          <FolderTree className="h-5 w-5 text-blue-400" />
          Files
        </h2>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="p-2">{renderFileTree(fileStructure)}</div>
      </div>
    </div>
  );
}