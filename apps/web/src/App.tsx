import React, { useState } from 'react';
import { AppShell } from './layout/AppShell';
import { RouterView, UserRole } from './routes/Router';

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState('/dashboard');
  const [userRole, setUserRole] = useState<UserRole>('pm');

  return (
    <AppShell
      currentPath={currentPath}
      userRole={userRole}
      onNavigate={setCurrentPath}
      onRoleChange={setUserRole}
    >
      <RouterView
        currentPath={currentPath}
        userRole={userRole}
        onNavigate={setCurrentPath}
      />
    </AppShell>
  );
};

export default App;
