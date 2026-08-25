import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './reports/ReportStudio.css';
import './fees/FeeSuccessCompensation.css';
import './integrations/GoogleWorkspaceCaseTools.css';
import './layout/StatusFeedbackState.css';
import './layout/WorkspaceHelpCenter.css';
import './workflow/ProjectWorkflowSchedule.css';
import './workflow/ProjectSchedulePrint.css';
import './documents/RhwpEditorDialog.css';
import './documents/StructuredDocumentCollaboration.css';
import './documents/StructuredDocumentEditor.css';
import './workflow/ProposalAwardWorkflow.css';
import './workflow/WorkflowOperations.css';
import './proposals/ProposalLibraryView.css';
import './intakes/IntakeLibraryView.css';
import './evidence/CaseEvidencePanel.css';
import './routes/PreviewAiAdmin.css';
import './routes/PreviewReportStudio.css';
import './routes/PreviewLitigationCenter.css';
import './routes/PreviewQualityCenters.css';
import './routes/PreviewSettings.css';
import './preview-theme.css';
import './theme-system.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
