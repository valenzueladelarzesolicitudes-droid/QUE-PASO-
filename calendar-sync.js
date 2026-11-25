(() => {
  const {url, publishableKey} = window.calendarConfig ?? {};
  if (!url || !publishableKey) return;

  const fields = 'id,title,date,type,important,done';

  function loadClient() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js';
      script.integrity = 'sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ';
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  function result({data, error}) {
    if (error) throw error;
    return data;
  }

  window.connectCalendar = async () => {
    await loadClient();
    const client = window.supabase.createClient(url, publishableKey);
    const table = () => client.from('calendar_items');
    return {
      onSession: callback => client.auth.onAuthStateChange((event, session) => callback(session)),
      signIn: (email, password) => client.auth.signInWithPassword({email, password}).then(result),
      updatePassword: password => client.auth.updateUser({password}).then(result),
      sendAccessLink: email => client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: new URL('./', location.href).href
        }
      }).then(result),
      signOut: () => client.auth.signOut({scope: 'local'}).then(result),
      async subscribe(onChange, onStatus) {
        await client.realtime.setAuth();
        const channel = client.channel('calendar:shared', {config: {private: true}})
          .on('broadcast', {event: 'changed'}, onChange)
          .subscribe(onStatus);
        return () => client.removeChannel(channel);
      },
      async read() {
        const rows = [];
        let lastId;
        while (true) {
          let query = table().select(fields).order('id').limit(500);
          if (lastId !== undefined) query = query.gt('id', lastId);
          const page = result(await query);
          if (!page.length) return rows;
          rows.push(...page);
          lastId = page[page.length - 1].id;
        }
      },
      async insert(item) {
        return result(await table().insert(item).select(fields).single());
      },
      async update(id, changes) {
        return result(await table().update(changes).eq('id', id).select(fields).single());
      },
      async remove(id) {
        result(await table().delete().eq('id', id).select('id').single());
      },
      async import(items) {
        result(await table().upsert(items, {
          onConflict: 'id',
          ignoreDuplicates: true
        }));
      }
    };
  };
})();
