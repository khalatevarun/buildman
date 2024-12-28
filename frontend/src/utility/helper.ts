import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { FileItem } from '../types';

export const handleDownload = async (files: FileItem[]) => {
  const zip = new JSZip();

  const addFilesToZip = (folderStructure: FileItem[], folder: JSZip) => {
    folderStructure.forEach(item => {
      if (item.type === 'folder') {
        const newFolder = folder.folder(item.name);
        if (item.children) {
          addFilesToZip(item.children, newFolder as JSZip);
        }
      } else {
        folder.file(item.name, item.content);
      }
    });
  };

  addFilesToZip(files, zip);

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'project.zip');
};