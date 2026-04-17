
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined') return 'denied';

  // @ts-ignore
  if (window.electronAPI) {
    // @ts-ignore
    return await window.electronAPI.requestNotificationPermission();
  }

  if (!("Notification" in window)) {
    console.warn("Este navegador no soporta notificaciones de escritorio");
    return 'denied';
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  return await Notification.requestPermission();
}

export function sendNotification(title: string, body: string, options: NotificationOptions = {}) {
  if (typeof window === 'undefined') return;

  // Si la ventana está visible y enfocada, quizás no queramos molestar, 
  // pero el usuario ha pedido notificaciones del sistema.
  
  // @ts-ignore
  if (window.electronAPI) {
    // @ts-ignore
    window.electronAPI.sendNotification(title, body);
    return;
  }

  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico',
      ...options
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

export function playNotificationSound() {
  const audio = new Audio('/notify.mp3');
  audio.play().catch(e => console.warn("No se pudo reproducir el sonido de notificación:", e));
}
