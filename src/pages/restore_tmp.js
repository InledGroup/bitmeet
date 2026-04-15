	// 1. GESTIÓN DE CONTACTOS Y BLOQUEO
	btnToggleContact?.addEventListener('click', async () => {
		await toggleContact();
	});

	btnSaveContact?.addEventListener('click', async () => {
		await toggleContact();
	});

	async function toggleContact() {
		if (!currentChatPubKey || !currentChatId) return;
		let name = document.getElementById('active-chat-name')!.textContent || '';

		if (name.includes('Desconocido')) {
			const chat = await chatRepo.getChat(currentChatId);
			if (chat) {
				const lastMsgWithName = [...chat.messages].reverse().find(m => (m as any).senderUsername && m.senderPubKey !== myIdentity.publicKey);
				if (lastMsgWithName) {
					name = (lastMsgWithName as any).senderUsername;
					document.getElementById('active-chat-name')!.textContent = name;
				}
			}
		}

		const existing = await chatRepo.getContact(currentChatPubKey);

		if (existing) {
			await chatRepo.deleteContact(currentChatPubKey);
			btnToggleContact?.classList.remove('active');
		} else {
			await chatRepo.saveContact({
				publicKey: currentChatPubKey,
				username: name,
				isFavorite: true
			});
			btnToggleContact?.classList.add('active');
		}
		await updateContactUI(currentChatPubKey);
		loadContacts();
	}

	btnBlockUser?.addEventListener('click', async () => {
		if (!currentChatPubKey) return;
		if (confirm("¿Estás seguro de que quieres bloquear a este usuario? No volverás a ver sus mensajes.")) {
			await chatRepo.saveContact({
				publicKey: currentChatPubKey,
				username: "Usuario Bloqueado",
				isFavorite: false,
				isBlocked: true
			} as any);
			viewActiveChat?.classList.add('hidden');
			viewNoChat?.classList.remove('hidden');
			loadContacts();
		}
	});

	async function updateContactUI(pubKey: string) {
		const contact = await chatRepo.getContact(pubKey);
		if (contact) {
			btnToggleContact?.classList.add('active');
			unknownActions?.classList.add('hidden');
		} else {
			btnToggleContact?.classList.remove('active');
			unknownActions?.classList.remove('hidden');
		}
	}

	// 2. NAVEGACIÓN Y BÚSQUEDA
	document.querySelectorAll('.sidebar-icon[data-view]').forEach(icon => {
		icon.addEventListener('click', (e) => {
			document.querySelectorAll('.sidebar-icon').forEach(i => i.classList.remove('active'));
			const target = e.currentTarget as HTMLElement;
			target.classList.add('active');
			const view = target.getAttribute('data-view');
			const panelTitle = document.getElementById('panel-title');
			if (panelTitle) panelTitle.textContent = view!.charAt(0).toUpperCase() + view!.slice(1);
			
			if (view === 'chat') {
				loadContacts();
				searchResults?.classList.add('hidden');
				chatsList?.classList.remove('hidden');
			} else if (view === 'teams') {
				loadColleagues(); 
			} else {
				if (chatsList) chatsList.innerHTML = `<div class="loading-state">Próximamente</div>`;
			}
		});
	});

	let searchTimeout: any;
	globalSearch?.addEventListener('input', (e) => {
		const q = (e.target as HTMLInputElement).value.trim();
		clearTimeout(searchTimeout);
		if (q.length < 2) {
			searchResults?.classList.add('hidden');
			chatsList?.classList.remove('hidden');
			return;
		}

		searchTimeout = setTimeout(async () => {
			searchResults?.classList.remove('hidden');
			chatsList?.classList.add('hidden');
			searchResults!.innerHTML = '<div class="loading-state">Buscando...</div>';
			
			const users = await bitid.searchUsers(q);
			if (users.length === 0) {
				searchResults!.innerHTML = '<div class="empty-results">Sin resultados</div>';
			} else {
				searchResults!.innerHTML = users.map((u: any) => `
					<div class="chat-item search-item" data-pubkey="${u.public_key}" data-username="${u.username}">
						<div class="chat-avatar">${u.username.charAt(0).toUpperCase()}</div>
						<div class="chat-info">
							<div class="chat-row"><strong>@${u.username}</strong></div>
							<div class="preview">Conectar</div>
						</div>
					</div>
				`).join('');

				searchResults!.querySelectorAll('.search-item').forEach(item => {
					item.addEventListener('click', async (ev) => {
						const pubKey = (ev.currentTarget as HTMLElement).getAttribute('data-pubkey');
						const username = (ev.currentTarget as HTMLElement).getAttribute('data-username');
						globalSearch.value = '';
						searchResults?.classList.add('hidden');
						chatsList?.classList.remove('hidden');
						await selectChat(pubKey!, username!);
					});
				});
			}
		}, 300);
	});

	async function loadContacts() {
		const savedContacts = await chatRepo.listContacts();
		const activeChats = await chatRepo.listAllChats();
		const colleagues = await bitid.getColleagues();
		
		const filteredSaved = savedContacts.filter(c => !c.isBlocked);
		const directContacts: any[] = [...filteredSaved];
		
		colleagues.forEach(c => {
			const existing = directContacts.find(a => a.publicKey === c.public_key);
			if (!existing) {
				directContacts.push({ publicKey: c.public_key, username: c.username, online_status: c.online_status });
			} else {
				existing.online_status = c.online_status;
			}
		});

		const groups: any[] = [];
		const otherDirects: any[] = [];

		for (const chat of activeChats) {
			if (chat.type === 'group') {
				groups.push({
					id: chat.id,
					username: chat.name || "Grupo sin nombre",
					isGroup: true,
					participants: chat.participants,
					lastUpdate: chat.lastUpdate
				});
				continue;
			}

			const otherPubKey = chat.participants.find(p => p !== myIdentity.publicKey);
			if (!otherPubKey) continue;

			const existing = directContacts.find(a => a.publicKey === otherPubKey);
			const contact = await chatRepo.getContact(otherPubKey);
			if (contact?.isBlocked) continue;

			if (!existing) {
				const otherMsgWithName = [...chat.messages].reverse().find(m => m.senderPubKey === otherPubKey && (m as any).senderUsername);
				const displayName = contact?.username || (otherMsgWithName as any)?.senderUsername || `Desconocido (${otherPubKey.substring(0, 6)})`;

				otherDirects.push({ 
					publicKey: otherPubKey, 
					username: displayName,
					isNew: true,
					lastUpdate: chat.lastUpdate
				});
			} else {
				if (existing.username.includes('Desconocido')) {
					const otherMsgWithName = [...chat.messages].reverse().find(m => m.senderPubKey === otherPubKey && (m as any).senderUsername);
					if (otherMsgWithName) existing.username = (otherMsgWithName as any).senderUsername;
				}
				existing.lastUpdate = chat.lastUpdate;
			}
		}

		const all = [...groups, ...directContacts, ...otherDirects].sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0));

		await Promise.all(all.filter(c => !c.isGroup).map(async c => {
			const isConnected = await p2p.isConnected(c.publicKey);
			if (isConnected) {
				c.online_status = 'online';
			} else {
				c.online_status = await p2p.getPresence(c.publicKey);
			}
		}));

		renderContactList(all);
	}

	setInterval(() => {
		loadContacts();
		retryPendingMessages();
	}, 10000);

	async function loadColleagues() {
		const colleagues = await bitid.getColleagues();
		renderContactList(colleagues.map(c => ({ publicKey: c.public_key, username: c.username, online_status: c.online_status })));
	}

	function renderContactList(list: any[]) {
		if (chatsList) {
			if (list.length === 0) {
				chatsList.innerHTML = '<div class="empty-results">No hay contactos</div>';
				return;
			}
			chatsList.innerHTML = list.map(c => `
				<div class="chat-item ${c.isNew ? 'new-chat' : ''} ${c.isGroup ? 'group-item' : ''}" 
					 data-id="${c.isGroup ? c.id : c.publicKey}" 
					 data-type="${c.isGroup ? 'group' : 'direct'}">
					<div class="chat-avatar ${c.isGroup ? 'group-avatar' : ''}">${c.username.charAt(0).toUpperCase()}</div>
					<div class="chat-info">
						<div class="chat-row">
							<strong>${c.isGroup ? '👥 ' : ''}${c.username}</strong> 
							${c.online_status ? `<span class="status-dot ${c.online_status === 'online' ? 'online' : 'offline'}"></span>` : ''}
						</div>
						<div class="preview">${c.isGroup ? `${c.participants.length} participantes` : (c.isNew ? 'Nuevo mensaje' : (c.online_status === 'online' ? 'Disponible' : 'Desconectado'))}</div>
					</div>
				</div>
			`).join('');

			chatsList.querySelectorAll('.chat-item').forEach(item => {
				item.addEventListener('click', async (e) => {
					const target = e.currentTarget as HTMLElement;
					const id = target.getAttribute('data-id');
					const type = target.getAttribute('data-type') as 'direct' | 'group';
					const name = target.querySelector('strong')?.textContent?.replace('👥 ', '');
					await selectChat(id!, name!, type);
				});
			});
		}
	}

	async function selectChat(id: string, name: string, type: 'direct' | 'group' = 'direct') {
		viewNoChat?.classList.add('hidden');
		viewActiveChat?.classList.remove('hidden');
		document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
		
		const selector = `[data-id="${id}"]`;
		const item = document.querySelector(selector);
		item?.classList.remove('unread');
		item?.classList.add('active');
		
		document.getElementById('active-chat-name')!.textContent = name;
		currentChatType = type;

		const statusEl = document.getElementById('active-chat-status')!;
		const statusDot = document.getElementById('active-chat-status-dot')!;
		const btnVoice = document.getElementById('btn-call-voice');
		const btnVideo = document.getElementById('btn-call-video');
		const btnGSettings = document.getElementById('btn-group-settings');
		
		if (type === 'group') {
			currentChatId = id;
			currentChatPubKey = null;
			const chat = await chatRepo.getChat(id);
			currentGroupParticipants = chat?.participants || [];
			currentGroupOwner = chat?.owner || null;
			
			statusEl.textContent = `${currentGroupParticipants.length} participantes`;
			statusDot.className = 'status-dot online';
			
			if (btnVoice) btnVoice.classList.add('hidden');
			if (btnVideo) btnVideo.classList.add('hidden');
			if (btnGSettings) btnGSettings.classList.remove('hidden');
		} else {
			currentChatId = await getChatId(myIdentity.publicKey, id);
			currentChatPubKey = id;
			currentGroupParticipants = [];
			currentGroupOwner = null;

			if (btnVoice) btnVoice.classList.remove('hidden');
			if (btnVideo) btnVideo.classList.remove('hidden');
			if (btnGSettings) btnGSettings.classList.add('hidden');

			statusEl.textContent = 'Conectando...';
			const connected = await p2p.connectToPeer(id);
			statusEl.textContent = connected ? 'Conexión Segura' : 'Offline';
			statusDot.className = `status-dot ${connected ? 'online' : 'offline'}`;
			
			await updateContactUI(id);
		}
		
		const input = document.getElementById('chat-input') as HTMLInputElement;
		input.value = ''; input.focus();

		loadContacts();
		await loadChatHistory(currentChatId);
		
		if (type === 'direct') retryPendingMessages(await p2p.hashPubKey(id));
		else retryPendingMessages();
	}

	async function loadChatHistory(chatId: string) {
		const container = document.getElementById('messages-list')!;
		container.innerHTML = '<div class="loading-state">Cargando...</div>';
		const chat = await chatRepo.getChat(chatId);
		container.innerHTML = '';
		if (chat) {
			chat.messages.forEach(m => renderMessage(m));
			scrollToBottom();
		}
	}
