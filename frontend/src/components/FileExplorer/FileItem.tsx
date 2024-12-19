import React from 'react';
import { ChevronRight, ChevronDown, FileCode, FolderIcon } from 'lucide-react';

interface FileItemProps {
  name: string;
  type: 'file' | 'folder';
  level: number;
  isOpen?: boolean;
  content?: string;
  onToggle: () => void;
  onSelect: () => void;
}

export default function FileItem({
  name,
  type,
  level,
  isOpen,
  onToggle,
  onSelect
}: FileItemProps) {
  return (
    <div
      className="flex items-center gap-1 py-1 px-2 hover:bg-gray-800 rounded cursor-pointer text-gray-300"
      style={{ paddingLeft: `${level * 1.5}rem` }}
      onClick={type === 'folder' ? onToggle : onSelect}
    >
      {type === 'folder' && (
        <button className="p-0.5">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      )}
      {type === 'folder' ? (
        <FolderIcon className="h-4 w-4 text-blue-400" />
      ) : (
        <FileCode className="h-4 w-4 text-gray-400" />
      )}
      <span>{name}</span>
    </div>
  );
}