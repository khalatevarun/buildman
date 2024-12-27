import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import FileExplorer from '../components/FileExplorer/FileExplorer';
import Content from '../components/Workspace/Content';
import { BuildSteps } from '../components/BuildSteps';
import { FileItem, Step, StepType } from '../types';
import { parseXml } from '../steps';
import { useWebContainer } from '../hooks/useWebContainer';
import { WebContainer } from '@webcontainer/api';
import { getChatResponse, getTemplate } from '../utility/api';

export default function Workspace() {
  const location = useLocation();
  const { prompt } = location.state || { prompt: '' };
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentStep, setCurrentStep] = useState('');
  const [files, setFiles] = useState<any[]>([]);
  const webcontainer = useWebContainer();
  const [userPrompt, setUserPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [llmMessages, setLlmMessages] = useState<{role: "user" | "assistant", content: string;}[]>([]);


  const handlePromptChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUserPrompt(event.target.value);
  };

  console.log("webcontainer in Worksapce>>>", webcontainer)

  useEffect(() => {
    let originalFiles = [...files];
    let updateHappened = false;
    steps.filter(({status}) => status === "pending").map(step => {
      updateHappened = true;
      if (step?.type === StepType.CreateFile) {
        let parsedPath = step.path?.split("/") ?? []; // ["src", "components", "App.tsx"]
        let currentFileStructure = [...originalFiles]; // {}
        let finalAnswerRef = currentFileStructure;
  
        let currentFolder = ""
        while(parsedPath.length) {
          currentFolder =  `${currentFolder}/${parsedPath[0]}`;
          let currentFolderName = parsedPath[0];
          parsedPath = parsedPath.slice(1);
  
          if (!parsedPath.length) {
            // final file
            let file = currentFileStructure.find(x => x.path === currentFolder)
            if (!file) {
              currentFileStructure.push({
                name: currentFolderName,
                type: 'file',
                path: currentFolder,
                content: step.code
              })
            } else {
              file.content = step.code;
            }
          } else {
            /// in a folder
            let folder = currentFileStructure.find(x => x.path === currentFolder)
            if (!folder) {
              // create the folder
              currentFileStructure.push({
                name: currentFolderName,
                type: 'folder',
                path: currentFolder,
                children: []
              })
            }
  
            currentFileStructure = currentFileStructure.find(x => x.path === currentFolder)!.children!;
          }
        }
        originalFiles = finalAnswerRef;
      }

    })

    if (updateHappened) {

      setFiles(originalFiles)
      setSteps(steps => steps.map((s: Step) => {
        return {
          ...s,
          status: "completed"
        }
        
      }))
    }
    console.log(files);
  }, [steps, files]);

  useEffect(() => {
    const createMountStructure = (files: FileItem[]): Record<string, any> => {
      const mountStructure: Record<string, any> = {};
  
      const processFile = (file: FileItem, isRootFolder: boolean) => {  
        if (file.type === 'folder') {
          mountStructure[file.name] = {
            directory: file.children ? 
              Object.fromEntries(
                file.children.map(child => [child.name, processFile(child, false)])
              ) 
              : {}
          };
        } else if (file.type === 'file') {
          if (isRootFolder) {
            mountStructure[file.name] = {
              file: {
                contents: file.content || ''
              }
            };
          } else {
            // For files, create a file entry with contents
            return {
              file: {
                contents: file.content || ''
              }
            };
          }
        }
  
        return mountStructure[file.name];
      };
  
      // Process each top-level file/folder
      files.forEach(file => processFile(file, true));
  
      return mountStructure;
    };
  
    const mountStructure = createMountStructure(files);
  
    // Mount the structure if WebContainer is available
    console.log(mountStructure);
    webcontainer?.mount(mountStructure);
  }, [files, webcontainer]);





  async function init() {
    const response = await getTemplate(prompt);
    
    const {prompts, uiPrompts} = response.data;

    setSteps(parseXml(uiPrompts[0]).map((x: Step) => ({
      ...x,
      status: "pending"
    })));

    setLoading(true);

    const messagesPayload = [...prompts, prompt].map(content => ({
      role: "user",
      content
    }))
    const stepsResponse = await getChatResponse(messagesPayload);

    setLoading(false);

    setSteps(s => [...s, ...parseXml(stepsResponse.data.response).map(x => ({
      ...x,
      status: "pending" as "pending"
    }))]);

    setLlmMessages([...prompts, prompt].map(content => ({
      role: "user",
      content
    })));

    setLlmMessages(x => [...x, {role: "assistant", content: stepsResponse.data.response}])
  }

  useEffect(() => {
    init();
  }, [])

  return (
    <div className="h-screen flex bg-gray-900">
    {/* Left Sidebar - Steps */}
    <div className="w-90 bg-gray-900 border-r border-gray-700 p-4 overflow-y-auto">
      <BuildSteps
       steps={steps}
       currentStep={currentStep}
       onStepClick={setCurrentStep}
      />
      <div className="mt-4">
          <input
            type="text"
            value={userPrompt}
            onChange={handlePromptChange}
            placeholder="Enter your prompt"
            className="w-full p-2 rounded bg-gray-800 text-gray-100"
          />
          <button
            onClick={async () => {
              const newMessage = {
                role: "user" as "user",
                content: userPrompt
              };

              setLoading(true);
              const messagesPayload = [...llmMessages, newMessage];
              const stepsResponse = await getChatResponse(messagesPayload);
              setLoading(false);

              setLlmMessages(x => [...x, newMessage]);
              setLlmMessages(x => [...x, {
                role: "assistant",
                content: stepsResponse.data.response
              }]);
              
              setSteps(s => [...s, ...parseXml(stepsResponse.data.response).map(x => ({
                ...x,
                status: "pending" as "pending"
              }))]);
}}
            className="mt-2 w-full p-2 rounded bg-blue-600 text-gray-100"
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Submit'}
          </button>
        </div>
    </div>

    {/* File Explorer */}
    <div className="w-80 border-r border-gray-700">
      <FileExplorer files={files} onFileSelect={setSelectedFile} />
    </div>

    {/* Content Area */}
    <div className="flex-1">
      <Content selectedFile={selectedFile} webContainer={webcontainer as WebContainer} />
    </div>
  </div>
  );
}