import OpenClawChatUI
import SwiftUI

struct CommandCenterTab: View {
    @Environment(NodeAppModel.self) private var appModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @State private var recentChatSessions: [OpenClawChatSessionEntry] = []
    var openChat: () -> Void
    var openSettings: () -> Void

    enum WorkRoute {
        case chat(String?)
        case settings
    }

    struct WorkItem: Identifiable {
        let id: String
        let icon: String
        let title: String
        let detail: String
        let state: String
        let trailing: String
        let color: Color
        let progress: Double?
        let route: WorkRoute
    }

    struct ApprovalItem: Identifiable {
        let id: String
        let icon: String
        let title: String
        let detail: String
        let priority: String
        let color: Color
    }

    var body: some View {
        NavigationStack {
            ZStack {
                CommandControlBackground()
                self.commandAmbientOverlay
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        self.header
                        self.gatewayCard
                        self.pendingApprovals
                        self.recentSessions
                        self.liveActivity
                        self.startWorkAction
                    }
                    .padding(.top, 16)
                    .padding(.bottom, 18)
                }
                .safeAreaPadding(.bottom, OpenClawProMetric.bottomScrollInset)
            }
            .navigationBarHidden(true)
        }
        .task(id: self.recentSessionsRefreshID) {
            await self.refreshRecentSessionsIfNeeded()
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 11) {
            OpenClawProMark(size: 31, shadowRadius: 9)
            Text("OpenClaw")
                .font(.system(size: 27, weight: .bold, design: .rounded))
            Spacer()
        }
        .padding(.horizontal, OpenClawProMetric.pagePadding)
    }

    private var commandAmbientOverlay: some View {
        Group {
            if self.colorScheme == .light {
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.05),
                        Color.clear,
                    ],
                    startPoint: .top,
                    endPoint: .bottom)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
        }
    }

    private var gatewayCard: some View {
        CommandPanel(isProminent: true, padding: 12) {
            VStack(alignment: .leading, spacing: 10) {
                self.cardHeader(
                    title: "Gateway",
                    value: self.gatewayStateText,
                    color: self.gatewayStatusColor,
                    icon: self.gatewayConnected ? "hourglass" : "wifi.slash")

                HStack(spacing: 0) {
                    self.gatewayFact(
                        icon: "network",
                        title: "Connection",
                        value: self.gatewayConnected ? "Online" : "Offline",
                        color: self.gatewayStatusColor)
                    Divider().frame(height: 38)
                    self.gatewayFact(
                        icon: "server.rack",
                        title: "Address",
                        value: self.gatewayAddressText,
                        color: OpenClawBrand.accent)
                    Divider().frame(height: 38)
                    self.gatewayFact(
                        icon: "person.2.fill",
                        title: "Agents",
                        value: self.gatewayAgentCountText,
                        color: OpenClawBrand.accentHot)
                }
                .padding(.vertical, 9)
                .background {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(self.colorScheme == .dark ? Color.black.opacity(0.16) : Color.black.opacity(0.026))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(
                                    Color.primary.opacity(self.colorScheme == .dark ? 0.08 : 0.045),
                                    lineWidth: 1)
                        }
                }
            }
        }
        .padding(.horizontal, OpenClawProMetric.pagePadding)
    }

    private func gatewayFact(icon: String, title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(color)
                Text(title)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Text(value)
                .font(.caption.weight(.semibold))
                .foregroundStyle(title == "Connection" ? color : .primary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
    }

    private var pendingApprovals: some View {
        self.pendingApprovalsContent
            .padding(.horizontal, OpenClawProMetric.pagePadding)
    }

    private var pendingApprovalsContent: some View {
        CommandPanel(
            tint: self.pendingApproval == nil ? nil : OpenClawBrand.warn,
            isProminent: self.pendingApproval != nil,
            padding: self.pendingApproval == nil ? 11 : 13)
        {
            VStack(alignment: .leading, spacing: 10) {
                self.cardHeader(
                    title: "Pending approvals",
                    value: self.pendingApproval == nil ? nil : "Review requests ›",
                    color: OpenClawBrand.accentHot,
                    badgeValue: self.approvalItems.isEmpty ? nil : "\(self.approvalItems.count)")

                if self.approvalItems.isEmpty {
                    CommandEmptyStateRow(
                        icon: "checkmark.shield.fill",
                        title: "No approvals waiting",
                        detail: self
                            .gatewayConnected ? "Gateway requests will appear here." : "Connect to the gateway.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(self.approvalItems.enumerated()), id: \.element.id) { index, item in
                            CommandApprovalRow(item: item)
                            if index < self.approvalItems.count - 1 {
                                Divider().padding(.leading, 48)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(self.approvalRowsFill)
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(
                                        Color.primary.opacity(self.colorScheme == .dark ? 0.08 : 0.04),
                                        lineWidth: 1)
                            }
                    }
                }

                if let pendingApproval {
                    HStack(spacing: 8) {
                        Button {
                            Task { await self.appModel.resolvePendingExecApprovalPrompt(decision: "allow-once") }
                        } label: {
                            Label("Allow", systemImage: "checkmark")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(self.appModel.pendingExecApprovalPromptResolving)

                        if pendingApproval.allowsAllowAlways {
                            Button {
                                Task {
                                    await self.appModel.resolvePendingExecApprovalPrompt(decision: "allow-always")
                                }
                            } label: {
                                Label("Always", systemImage: "checkmark.shield")
                            }
                            .buttonStyle(.bordered)
                            .disabled(self.appModel.pendingExecApprovalPromptResolving)
                        }

                        Button(role: .destructive) {
                            Task { await self.appModel.resolvePendingExecApprovalPrompt(decision: "deny") }
                        } label: {
                            Label("Deny", systemImage: "xmark")
                        }
                        .buttonStyle(.bordered)
                        .disabled(self.appModel.pendingExecApprovalPromptResolving)

                        Spacer(minLength: 0)
                    }
                    .controlSize(.small)
                }
            }
        }
    }

    private var recentSessions: some View {
        CommandPanel(padding: 0) {
            VStack(spacing: 0) {
                self.cardHeader(
                    title: "Recent sessions",
                    value: nil,
                    color: .secondary)
                    .padding(.horizontal, 12)
                    .padding(.top, 10)
                    .padding(.bottom, 3)

                if self.recentSessionPreviewRows.isEmpty {
                    CommandEmptyStateRow(
                        icon: self.gatewayConnected ? "bubble.left.and.text.bubble.right.fill" : "wifi.slash",
                        title: self.gatewayConnected ? "No recent sessions" : "Gateway offline",
                        detail: self
                            .gatewayConnected ? "Start a chat and it will appear here." : "Connect to the gateway.")
                        .padding(.horizontal, 10)
                        .padding(.bottom, 10)
                } else {
                    VStack(spacing: 8) {
                        ForEach(self.recentSessionPreviewRows) { item in
                            Button {
                                self.open(item.route)
                            } label: {
                                CommandSessionRow(item: item)
                            }
                            .buttonStyle(.plain)
                        }

                        if self.hasMoreRecentSessions {
                            NavigationLink {
                                CommandSessionsScreen(openChat: self.openChat)
                            } label: {
                                CommandViewMoreRow()
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
                }
            }
        }
        .padding(.horizontal, OpenClawProMetric.pagePadding)
    }

    private var liveActivity: some View {
        CommandPanel(padding: 0) {
            VStack(spacing: 0) {
                self.cardHeader(
                    title: "Live activity",
                    value: nil,
                    color: OpenClawBrand.accent)
                    .padding(.horizontal, 12)
                    .padding(.top, 11)
                    .padding(.bottom, 3)

                CommandLiveActivityRow(
                    title: self.liveActivityTitle,
                    value: self.liveActivityValue,
                    color: self.liveActivityColor)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }
        }
        .padding(.horizontal, OpenClawProMetric.pagePadding)
    }

    private var startWorkAction: some View {
        CommandPanel(tint: OpenClawBrand.accent, isProminent: true, padding: 9) {
            Button(action: self.openChat) {
                Label("Start work", systemImage: "play.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background {
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .fill(LinearGradient(
                                colors: [OpenClawBrand.accentHot, OpenClawBrand.accent],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing))
                            .shadow(color: OpenClawBrand.accentHot.opacity(0.34), radius: 18, y: 8)
                    }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, OpenClawProMetric.pagePadding)
    }

    private func cardHeader(
        title: String,
        value: String?,
        color: Color,
        icon: String? = nil,
        badgeValue: String? = nil,
        action: (() -> Void)? = nil) -> some View
    {
        HStack(spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.bold))
            if let badgeValue {
                Text(badgeValue)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(OpenClawBrand.accentHot, in: Capsule())
            }
            Spacer(minLength: 8)
            if let value {
                if let action {
                    Button(value, action: action)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(color)
                } else {
                    HStack(spacing: 4) {
                        if let icon {
                            Image(systemName: icon)
                                .font(.caption2.weight(.bold))
                        }
                        Text(value)
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(color)
                }
            }
        }
    }

    private var gatewayConnected: Bool {
        GatewayStatusBuilder.build(appModel: self.appModel) == .connected
    }

    private var gatewayStateText: String {
        guard !self.gatewayConnected else { return "Healthy" }
        let status = self.appModel.gatewayDisplayStatusText.trimmingCharacters(in: .whitespacesAndNewlines)
        let lowercased = status.lowercased()
        if lowercased.contains("approval") { return "Approval" }
        if lowercased.contains("reconnect") { return "Reconnecting" }
        if lowercased.contains("connect") { return "Connecting" }
        if lowercased.contains("idle") { return "Idle" }
        return "Offline"
    }

    private var gatewayStatusColor: Color {
        self.gatewayConnected ? OpenClawBrand.ok : .secondary
    }

    private var gatewayAddressText: String {
        self.normalized(self.appModel.gatewayRemoteAddress)
            ?? self.normalized(self.appModel.gatewayServerName)
            ?? "Unknown"
    }

    private var gatewayAgentCountText: String {
        guard self.gatewayConnected else { return "—" }
        return "\(self.appModel.gatewayAgents.count)"
    }

    private var approvalItems: [ApprovalItem] {
        if let pendingApproval {
            return [
                ApprovalItem(
                    id: "pending-real",
                    icon: "terminal.fill",
                    title: pendingApproval.commandPreview ?? "Review gateway action",
                    detail: "Agent: \(self.appModel.activeAgentName)",
                    priority: self.appModel.pendingExecApprovalPromptResolving ? "Resolving" : "High",
                    color: OpenClawBrand.danger),
                ApprovalItem(
                    id: "pending-context",
                    icon: "doc.text.fill",
                    title: pendingApproval.allowsAllowAlways ? "Permission can be saved" : "One-time approval",
                    detail: "Gateway request",
                    priority: pendingApproval.allowsAllowAlways ? "Medium" : "Review",
                    color: OpenClawBrand.warn),
            ]
        }

        return []
    }

    private var approvalRowsFill: Color {
        self.colorScheme == .dark ? Color.black.opacity(0.12) : Color.black.opacity(0.022)
    }

    private var recentSessionRows: [WorkItem] {
        self.sessionItems
    }

    private var recentSessionPreviewRows: [WorkItem] {
        Array(self.recentSessionRows.prefix(3))
    }

    private var hasMoreRecentSessions: Bool {
        self.sessionWorkItems.count > self.recentSessionPreviewRows.count
    }

    private var liveActivityTitle: String {
        if let session = recentChatSessions.first(where: { !Self.isHiddenInternalSession($0.key) }) {
            return "\(Self.sessionTitle(session)) updated"
        }
        if self.pendingApproval != nil {
            return "Approval waiting"
        }
        return self.gatewayConnected ? "Gateway connected" : self.gatewayStateText
    }

    private var liveActivityValue: String {
        if let session = recentChatSessions.first(where: { !Self.isHiddenInternalSession($0.key) }),
           let updatedAt = session.updatedAt,
           updatedAt > 0
        {
            return Self.relativeTimeText(forMilliseconds: updatedAt)
        }
        if self.pendingApproval != nil {
            return "review"
        }
        return self.gatewayConnected ? self.gatewayAddressText : self.gatewayDisplayStatusValue
    }

    private var liveActivityColor: Color {
        if self.pendingApproval != nil { return OpenClawBrand.warn }
        return self.gatewayConnected ? OpenClawBrand.ok : .secondary
    }

    private var gatewayDisplayStatusValue: String {
        let status = self.appModel.gatewayDisplayStatusText.trimmingCharacters(in: .whitespacesAndNewlines)
        return status.isEmpty ? self.gatewayStateText : status
    }

    private var recentSessionsRefreshID: String {
        [
            self.appModel.isOperatorGatewayConnected ? "connected" : "offline",
            self.appModel.chatSessionKey,
            self.scenePhase == .active ? "active" : "inactive",
        ].joined(separator: ":")
    }

    private var sessionItems: [WorkItem] {
        self.sessionWorkItems
    }

    private var sessionWorkItems: [WorkItem] {
        let currentSessionKey = self.appModel.chatSessionKey
        return self.recentChatSessions
            .filter { !Self.isHiddenInternalSession($0.key) }
            .map { session in
                Self.sessionWorkItem(for: session, currentSessionKey: currentSessionKey)
            }
    }

    private func open(_ route: WorkRoute) {
        switch route {
        case let .chat(sessionKey):
            self.appModel.openChat(sessionKey: sessionKey)
            self.openChat()
        case .settings:
            self.openSettings()
        }
    }

    private func refreshRecentSessionsIfNeeded() async {
        guard self.scenePhase == .active else { return }
        guard self.appModel.isOperatorGatewayConnected else {
            if !self.recentChatSessions.isEmpty {
                self.recentChatSessions = []
            }
            return
        }

        do {
            let transport = IOSGatewayChatTransport(gateway: appModel.operatorSession)
            let response = try await transport.listSessions(limit: 20)
            self.recentChatSessions = Self.sessionChoices(
                response.sessions,
                currentSessionKey: self.appModel.chatSessionKey)
        } catch {
            self.recentChatSessions = []
        }
    }

    private static func sessionChoices(
        _ sessions: [OpenClawChatSessionEntry],
        currentSessionKey: String) -> [OpenClawChatSessionEntry]
    {
        let sorted = sessions.sorted { ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) }
        var result: [OpenClawChatSessionEntry] = []
        var included = Set<String>()

        if let current = sorted.first(where: { $0.key == currentSessionKey }) {
            result.append(current)
            included.insert(current.key)
        }

        for session in sorted {
            guard !included.contains(session.key) else { continue }
            guard !Self.isHiddenInternalSession(session.key) else { continue }
            result.append(session)
            included.insert(session.key)
            if result.count >= 4 { break }
        }

        return result
    }

    fileprivate static func sessionWorkItem(
        for session: OpenClawChatSessionEntry,
        currentSessionKey: String) -> WorkItem
    {
        let isCurrent = session.key == currentSessionKey
        return WorkItem(
            id: "chat-session-\(session.key)",
            icon: isCurrent ? "bubble.left.and.text.bubble.right.fill" : "bubble.left.fill",
            title: Self.sessionTitle(session),
            detail: Self.sessionDetail(session),
            state: isCurrent ? "current" : "recent",
            trailing: "chat",
            color: isCurrent ? OpenClawBrand.accent : OpenClawBrand.ok,
            progress: nil,
            route: .chat(session.key))
    }

    fileprivate static func sessionTitle(_ session: OpenClawChatSessionEntry) -> String {
        if let title = redactedSessionTitle(for: session.key) {
            return title
        }

        let displayName = session.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let displayName, !displayName.isEmpty {
            return Self.redactedSessionTitle(for: displayName) ?? displayName
        }
        let subject = session.subject?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let subject, !subject.isEmpty {
            return Self.redactedSessionTitle(for: subject) ?? subject
        }
        return session.key
    }

    fileprivate static func redactedSessionTitle(for key: String) -> String? {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        let lowercased = trimmed.lowercased()
        guard !trimmed.isEmpty else { return nil }
        if lowercased.contains(":ios-") {
            return "iOS chat"
        }
        if lowercased.hasPrefix("telegram:") {
            return "Telegram chat"
        }
        if lowercased.hasPrefix("user:+") {
            return "Direct chat"
        }
        if lowercased.hasPrefix("cron:") {
            return Self.humanizedSessionKey(String(trimmed.dropFirst("cron:".count)))
        }
        return nil
    }

    fileprivate static func humanizedSessionKey(_ key: String) -> String? {
        let words = key
            .replacingOccurrences(of: "_", with: "-")
            .split(separator: "-")
            .map(String.init)
            .filter { !$0.isEmpty }
        guard !words.isEmpty else { return nil }

        return words
            .map { word in
                switch word.lowercased() {
                case "ai", "api", "ios", "qmd", "url":
                    word.uppercased()
                default:
                    word.prefix(1).uppercased() + String(word.dropFirst())
                }
            }
            .joined(separator: " ")
    }

    fileprivate static func sessionDetail(_ session: OpenClawChatSessionEntry) -> String {
        if let updatedAt = session.updatedAt, updatedAt > 0 {
            return self.relativeTimeText(forMilliseconds: updatedAt)
        }
        return session.key
    }

    fileprivate static func relativeTimeText(forMilliseconds milliseconds: Double) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.dateTimeStyle = .numeric
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: .now)
    }

    fileprivate static func isHiddenInternalSession(_ key: String) -> Bool {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return trimmed == "onboarding" || trimmed.hasSuffix(":onboarding")
    }

    private var gatewaySubtitle: String {
        if let server = normalized(appModel.gatewayServerName) {
            return "\(self.appModel.activeAgentName) on \(server)"
        }
        if let address = normalized(appModel.gatewayRemoteAddress) {
            return "\(self.appModel.activeAgentName) via \(address)"
        }
        return self.appModel.gatewayDisplayStatusText
    }

    private var pendingApproval: NodeAppModel.ExecApprovalPrompt? {
        self.appModel.pendingExecApprovalPrompt
    }

    private func normalized(_ value: String?) -> String? {
        Self.normalized(value)
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private struct CommandSessionsScreen: View {
    @Environment(NodeAppModel.self) private var appModel
    @Environment(\.dismiss) private var dismiss
    @State private var sessions: [OpenClawChatSessionEntry] = []
    @State private var isLoading = false
    @State private var loadErrorText: String?
    let openChat: () -> Void

    var body: some View {
        ZStack {
            CommandControlBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    self.header
                    self.sessionsPanel
                }
                .padding(.top, 16)
                .padding(.bottom, 18)
            }
            .safeAreaPadding(.bottom, OpenClawProMetric.bottomScrollInset)
        }
        .navigationTitle("Sessions")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: self.refreshID) {
            await self.refreshSessions()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Sessions")
                .font(.system(size: 27, weight: .bold, design: .rounded))
            Text(self.headerDetail)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, OpenClawProMetric.pagePadding)
    }

    private var sessionsPanel: some View {
        CommandPanel(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text("Recent sessions")
                        .font(.subheadline.weight(.bold))
                    Spacer(minLength: 8)
                    if self.isLoading {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 3)

                if let loadErrorText {
                    CommandEmptyStateRow(
                        icon: "exclamationmark.triangle.fill",
                        title: "Sessions unavailable",
                        detail: loadErrorText)
                        .padding(.horizontal, 10)
                        .padding(.bottom, 10)
                } else if self.sessionRows.isEmpty {
                    CommandEmptyStateRow(
                        icon: self.appModel
                            .isOperatorGatewayConnected ? "bubble.left.and.text.bubble.right.fill" : "wifi.slash",
                        title: self.appModel.isOperatorGatewayConnected ? "No recent sessions" : "Gateway offline",
                        detail: self.appModel
                            .isOperatorGatewayConnected ? "Start a chat and it will appear here." :
                            "Connect to the gateway.")
                        .padding(.horizontal, 10)
                        .padding(.bottom, 10)
                } else {
                    VStack(spacing: 8) {
                        ForEach(self.sessionRows) { item in
                            Button {
                                self.open(item)
                            } label: {
                                CommandSessionRow(item: item)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
                }
            }
        }
        .padding(.horizontal, OpenClawProMetric.pagePadding)
    }

    private var headerDetail: String {
        if self.isLoading, self.sessions.isEmpty { return "Loading recent sessions" }
        let count = self.sessionRows.count
        if count == 0 {
            return self.appModel.isOperatorGatewayConnected ? "No recent sessions" : "Gateway offline"
        }
        return "\(count) \(count == 1 ? "session" : "sessions")"
    }

    private var sessionRows: [CommandCenterTab.WorkItem] {
        self.sessions
            .filter { !CommandCenterTab.isHiddenInternalSession($0.key) }
            .sorted { ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) }
            .map {
                CommandCenterTab.sessionWorkItem(
                    for: $0,
                    currentSessionKey: self.appModel.chatSessionKey)
            }
    }

    private var refreshID: String {
        self.appModel.isOperatorGatewayConnected ? "connected" : "offline"
    }

    private func open(_ item: CommandCenterTab.WorkItem) {
        switch item.route {
        case let .chat(sessionKey):
            self.appModel.openChat(sessionKey: sessionKey)
            self.dismiss()
            self.openChat()
        case .settings:
            break
        }
    }

    private func refreshSessions() async {
        guard self.appModel.isOperatorGatewayConnected else {
            self.sessions = []
            self.loadErrorText = nil
            return
        }

        self.isLoading = true
        self.loadErrorText = nil
        defer { self.isLoading = false }

        do {
            let transport = IOSGatewayChatTransport(gateway: appModel.operatorSession)
            let response = try await transport.listSessions(limit: 200)
            self.sessions = response.sessions
        } catch {
            self.sessions = []
            self.loadErrorText = "Try again after the gateway reconnects."
        }
    }
}
