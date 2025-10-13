import React, { useState } from 'react';
import { Card, CardContent, Typography, List, ListItem, ListItemText, Button, Checkbox, Box, LinearProgress } from '@mui/material';
import axios from 'axios';

const Files = ({ files, onFilesDeleted, addLog }) => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [downloadProgress, setDownloadProgress] = useState({});

  const handleToggle = (file) => {
    const currentIndex = selectedFiles.findIndex(f => f.path === file.path && f.gopro.device === file.gopro.device);
    const newSelectedFiles = [...selectedFiles];

    if (currentIndex === -1) {
      newSelectedFiles.push(file);
    } else {
      newSelectedFiles.splice(currentIndex, 1);
    }
    setSelectedFiles(newSelectedFiles);
  };

  const handleApiCall = async (url, action, postData, config = {}) => {
    try {
      addLog(`Executing ${action}...`);
      const response = await axios.post(url, postData, config);
      if (response.data && response.data.logs) {
        if (Array.isArray(response.data.logs)) {
          response.data.logs.forEach(log => addLog(log));
        } else {
          addLog(response.data.logs);
        }
      }
      return response;
    } catch (error) {
      addLog(`❌ Error with ${action}: ${error.message}`);
      console.error(error);
      return null;
    }
  };

  const deleteSelectedFiles = async () => {
    const successfullyDeleted = [];
    for (const file of selectedFiles) {
      const response = await handleApiCall(`http://${file.host.address}/gopros/files/remove?path=${file.path}`, `delete file ${file.name}`, file.gopro);
      if (response) {
        successfullyDeleted.push(file);
      }
    }
    if (successfullyDeleted.length > 0) {
      onFilesDeleted(successfullyDeleted);
    }
    setSelectedFiles([]);
  };

  const downloadSelectedFiles = async () => {
    for (const file of selectedFiles) {
      const fileKey = `${file.gopro.device}-${file.path}`;
      const config = {
        responseType: 'blob',
        onDownloadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setDownloadProgress(prev => ({ ...prev, [fileKey]: percentCompleted }));
        }
      };

      const response = await handleApiCall(`http://${file.host.address}/gopros/files/download?path=${file.path}`, `download file ${file.name}`, file.gopro, config);

      if (response) {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', file.name);
        document.body.appendChild(link);
        link.click();
        link.remove();
        addLog(`✅ Download complete: ${file.name}`);
      }
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[fileKey];
        return newProgress;
      });
    }
  };

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}>
        <Box sx={{ flexShrink: 0, pb: 2 }}>
          <Typography variant="h6">File Explorer</Typography>
        </Box>
        <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
          <List>
            {(files || []).map((file, index) => {
              const fileKey = `${file.gopro.device}-${file.path}`;
              const progress = downloadProgress[fileKey];
              return (
                <ListItem key={`${file.gopro.device}-${file.name}-${index}`} dense button onClick={() => handleToggle(file)}>
                  <Checkbox
                    edge="start"
                    checked={selectedFiles.some(f => f.path === file.path && f.gopro.device === file.gopro.device)}
                    tabIndex={-1}
                    disableRipple
                  />
                  <ListItemText
                    primary={file.name}
                    secondary={
                      <>
                        {`${file.gopro.device} | ${file.size} | ${file.date}`}
                        {progress !== undefined && (
                          <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                            <Box sx={{ width: '100%', mr: 1 }}>
                              <LinearProgress variant="determinate" value={progress} />
                            </Box>
                            <Box sx={{ minWidth: 35 }}>
                              <Typography variant="body2" color="text.secondary">{`${progress}%`}</Typography>
                            </Box>
                          </Box>
                        )}
                      </>
                    }
                  />
                </ListItem>
              );
            })}
          </List>
        </Box>
      </CardContent>
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Button variant="contained" onClick={deleteSelectedFiles} disabled={selectedFiles.length === 0} sx={{ mr: 1 }}>Delete</Button>
        <Button variant="contained" onClick={downloadSelectedFiles} disabled={selectedFiles.length === 0}>Download</Button>
      </Box>
    </Card>
  );
};

export default Files;
