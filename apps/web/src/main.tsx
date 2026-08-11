import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './reports/ReportStudio.css';
import './fees/FeeSuccessCompensation.css';
import './integrations/GoogleWorkspaceCaseTools.css';
import './layout/StatusFeedbackState.css';
import './preview-theme.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
