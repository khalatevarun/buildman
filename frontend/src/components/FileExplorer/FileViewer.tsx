import React from 'react';
import { X } from 'lucide-react';

interface FileViewerProps {
  file: {
    name: string;
    content: string;
  } | null;
  onClose: () => void;
}

export default function FileViewer({ file, onClose }: FileViewerProps) {
  if (!file) return null;

  return (
    <div className="border-t border-gray-700">
      <div className="flex items-center justify-between p-2 bg-gray-800">
        <h3 className="text-sm text-gray-300">{file.name}</h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-700 rounded"
        >
          <X className="h-4 w-4 text-gray-400" />
        </button>
      </div>
      <pre className="p-4 text-sm text-gray-300 font-mono overflow-auto max-h-[500px]">
        {file.content}
      </pre>
    </div>
  );
}