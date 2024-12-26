import Editor from '@monaco-editor/react';

interface CodeEditorProps {
  file: { name: string; content: string } | null;
}

export default function CodeEditor({ file }: CodeEditorProps) {
  if (!file) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        Select a file to view its contents
      </div>
    );
  }

  const language = file.name.endsWith('.tsx') || file.name.endsWith('.ts')
    ? 'typescript'
    : file.name.endsWith('.css')
    ? 'css'
    : file.name.endsWith('.json')
    ? 'json'
    : 'javascript';

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={language}
      value={file.content}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 14,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
      }}
    />
  );
}