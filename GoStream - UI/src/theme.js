import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#bd93f9', // Purple
    },
    secondary: {
      main: '#50fa7b', // Green
    },
    background: {
      default: '#282a36', // Dark Purple/Gray
      paper: '#44475a',   // Lighter Gray
    },
    text: {
      primary: '#f8f8f2',   // Off-white
      secondary: '#6272a4', // Comment Gray
    },
    info: {
      main: '#8be9fd', // Cyan
    },
    error: {
        main: '#ff5555', // Red
    },
    warning: {
        main: '#ffb86c', // Orange
    },
    success: {
        main: '#50fa7b', // Green
    }
  },
  typography: {
    fontFamily: 'monospace',
    h6: {
        fontFamily: 'monospace',
    },
    body2: {
        fontFamily: 'monospace',
    },
    caption: {
        fontFamily: 'monospace',
    }
  },
});

export default theme;
