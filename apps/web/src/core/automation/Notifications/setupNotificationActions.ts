// @ts-nocheck
// Shared notifications and approval actions; server remains authoritative for RBAC.
import type { CustomNotificationMetadata, ApprovalRequestMetadata } from '../../metadata/Definitions/metadata';
export function createSetupNotificationActions(ctx: any) {
 const { apiRequest, notifications, notificationsOpen, notify, setApprovalBusyId, setApprovalRequests, setNotifications, setNotificationsLoading, setNotificationsOpen, setNotificationsUnreadCount } = ctx;
  const loadNotifications = async () => {
    setNotificationsLoading(true);
    try {
      const [result, approvalResult] = await Promise.all([
        apiRequest<{ notifications: CustomNotificationMetadata[]; unreadCount: number }>('/notifications'),
        apiRequest<{ requests: ApprovalRequestMetadata[] }>('/approvals/inbox')
      ]);
      setNotifications(result.notifications);
      setNotificationsUnreadCount(result.unreadCount);
      setApprovalRequests(approvalResult.requests);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to load notifications');
    } finally {
      setNotificationsLoading(false);
    }
  };

  const toggleNotifications = () => {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    if (opening) void loadNotifications();
  };

  const markNotificationRead = async (notification: CustomNotificationMetadata) => {
    if (notification.readAt) return;
    try {
      const result = await apiRequest<{ notification: CustomNotificationMetadata }>(
        `/notifications/${encodeURIComponent(notification.id)}/read`,
        { method: 'POST' }
      );
      setNotifications((current) => current.map((item) => item.id === notification.id ? result.notification : item));
      setNotificationsUnreadCount((current) => Math.max(0, current - 1));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to mark notification as read');
    }
  };

  const decideApproval = async (request: ApprovalRequestMetadata, decision: 'Approved' | 'Rejected') => {
    setApprovalBusyId(request.id);
    try {
      await apiRequest<{ request: ApprovalRequestMetadata }>(
        `/approvals/${encodeURIComponent(request.id)}/decision`,
        { method: 'POST', body: JSON.stringify({ decision }) }
      );
      setApprovalRequests((current) => current.filter((item) => item.groupId !== request.groupId));
      notify(`Approval request ${decision.toLowerCase()}`);
      void loadNotifications();
    } catch (error) {
      notify(error instanceof Error ? error.message : `Unable to ${decision.toLowerCase()} approval request`);
    } finally {
      setApprovalBusyId('');
    }
  };


 return { loadNotifications, toggleNotifications, markNotificationRead, decideApproval };
}
