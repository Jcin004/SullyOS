export default {
  manifest: {
    id: "xhs-real-card",
    name: "小红书真实卡片",
    apiVersion: 1,
    version: "9.2.0",
    author: "SullyOS",
    description: "支持连续多卡片展示与点击跳转，完全契合 MCP 协议",
    permissions: ["chat.read"],
    settings: [
      { key: "mcpUrl", label: "Vercel MCP 地址 (如 https://float04.vercel.app/api/xhs-mcp)", type: "text", default: "" }
    ]
  },

  setup(ctx) {
    const XHS_REGEX_GLOBAL = /(https?:\/\/(?:www\.)?(?:xiaohongshu\.com\/(?:explore|discovery\/item)\/[a-zA-Z0-9]+(?:\?[^\s"'<>]+)?|xhslink\.(?:cn|com)\/[a-zA-Z0-9_/?&=]+))/gi;

    function fmtNum(n) {
      if (!n && n !== 0) return "0";
      if (n >= 10000) return (n / 10000).toFixed(1) + "w";
      if (n >= 1000) return (n / 1000).toFixed(1) + "k";
      return String(n);
    }

    function buildSingleCard(data) {
      const mcpBase = (ctx.system.settings.get("mcpUrl") || "").trim().replace(/\/+$/, '');
      const coverUrl = data.coverUrl ? `${mcpBase}?img=${encodeURIComponent(data.coverUrl)}` : "";
      const title = data.title || "小红书笔记";
      const author = data.author || "小红书用户";

      if (data.loading) {
        return `<div class="card-item" data-link="${data.link || ''}" style="background:#fff;border-radius:10px;padding:14px;border:1px solid #e0e0e0;margin-bottom:8px;font-family:-apple-system,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:center;height:70px;color:#999;font-size:13px;">📖 正在获取真实笔记数据...</div>`;
      }
      if (data.error) {
        return `<div class="card-item" data-link="${data.link || ''}" style="background:#fff;border-radius:10px;padding:14px;border:1px solid #e0e0e0;margin-bottom:8px;font-family:-apple-system,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:center;height:70px;color:#c0271f;font-size:13px;">❌ ${data.error}</div>`;
      }

      return `<div class="card-item" data-link="${data.link || ''}" style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e0e0e0;margin-bottom:8px;font-family:-apple-system,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.06);cursor:pointer;-webkit-tap-highlight-color:transparent;">
        <div style="display:flex;padding:12px 14px;gap:12px;align-items:center;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:600;color:#333;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${title}</div>
            <div style="font-size:12px;color:#999;margin-top:4px;">@${author}</div>
            <div style="font-size:11px;color:#bbb;margin-top:2px;">${fmtNum(data.likedCount)}赞 · ${fmtNum(data.commentCount)}评论 · ${fmtNum(data.collectedCount)}收藏</div>
          </div>
          <div style="width:48px;height:48px;border-radius:6px;background:#f5f5f5;flex-shrink:0;overflow:hidden;">
            ${coverUrl ? `<img src="${coverUrl}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>` : ''}
          </div>
        </div>
        <div style="border-top:1px solid #f0f0f0;padding:6px 14px;display:flex;align-items:center;gap:6px;">
          <div style="width:14px;height:14px;background:#ff2442;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:bold;">红</div>
          <span style="font-size:11px;color:#999;">小红书</span>
        </div>
      </div>`;
    }

    function renderAllCards(el, cards) {
      el.innerHTML = cards.map(c => buildSingleCard(c)).join('');
      el.style.cssText = "padding:0;margin:0;";
      el.querySelectorAll('.card-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          const targetUrl = item.getAttribute('data-link');
          if (targetUrl) window.open(targetUrl, '_blank');
        };
      });
    }

    ctx.ui.messageKind("xhs-real-card", (el, msg) => {
      let node = el.parentElement;
      for (let i = 0; i < 8 && node; i++) {
        if ((node.className || "").indexOf("chat-bubble-role-user") !== -1 || (node.className || "").indexOf("chat-bubble-role-assistant") !== -1) {
          node.classList.add("chat-bubble-media");
          node.style.padding = "0";
          break;
        }
        node = node.parentElement;
      }
      el.setAttribute("data-message-id", msg.id);
      const cards = Array.isArray(msg.mediaData?.cards) ? msg.mediaData.cards : [msg.mediaData || {}];
      renderAllCards(el, cards);
    });

    // 引导大模型可以根据语境连续分享 1~3 篇
    ctx.prompts.set(
      "【小红书工具指引】\n" +
      "当用户寻找小红书内容时，调用 `xhs_search` 搜索。\n" +
      "搜索完成后，在回复中你可以挑出 1~3 篇最贴切的笔记长链接贴出（每条链接单独占一行）。聊天窗口会自动为每一条链接渲染对应的图文卡片。"
    );

    // 捕获回复中出现的所有链接，构造成卡片列表
    ctx.hooks.transform("message.beforePersist", (payload) => {
      const msg = payload.message;
      if (!msg || !msg.content) return payload;
      if (msg.role !== "user" && msg.role !== "assistant") return payload;

      const matches = msg.content.match(XHS_REGEX_GLOBAL);
      if (matches && matches.length > 0) {
        msg.mediaType = "plugin:xhs-real-card";
        msg.mediaData = {
          cards: matches.map(url => ({ loading: true, link: url }))
        };
      }
      return payload;
    });

    // 逐个拉取真实笔记信息，流式展示
    ctx.hooks.on("message.persisted", async ({ message }) => {
      if (message.mediaType !== "plugin:xhs-real-card" || !message.mediaData?.cards) return;

      const msgId = message.id;
      const mcpBase = (ctx.system.settings.get("mcpUrl") || "").trim().replace(/\/+$/, '');
      if (!mcpBase) return;

      const currentCards = [...message.mediaData.cards];

      for (let i = 0; i < currentCards.length; i++) {
        const targetUrl = currentCards[i].link;
        try {
          const res = await ctx.system.fetch(`${mcpBase}?resolve_share=${encodeURIComponent(targetUrl)}`);
          const json = await res.json();
          if (json.ok && json.note) {
            currentCards[i] = { loading: false, link: targetUrl, noteId: json.noteId, ...json.note };
          } else {
            currentCards[i] = { loading: false, link: targetUrl, error: json.error || "解析失败" };
          }
        } catch (e) {
          currentCards[i] = { loading: false, link: targetUrl, error: "加载超时" };
        }

        // 每获取一篇刷新一次 DOM
        const cardEl = document.querySelector(`[data-message-id="${msgId}"]`);
        if (cardEl) renderAllCards(cardEl, currentCards);
      }

      ctx.data.messages.update(msgId, { mediaData: { cards: currentCards } });
    });

    ctx.system.log("[小红书卡片] v9.2.0 多卡片支持版已加载");
  }
};
