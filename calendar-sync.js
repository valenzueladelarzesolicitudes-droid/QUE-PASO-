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
    const supplierTable = () => client.from('supplier_orders');
    const supplierFields = 'id,supplier,month,year,order_number,invoice_number,status,received_on,notes';

    async function subscribe(topic, onChange, onStatus) {
      await client.realtime.setAuth();
      const channel = client.channel(topic, {config: {private: true}})
        .on('broadcast', {event: 'changed'}, onChange)
        .subscribe(onStatus);
      return () => client.removeChannel(channel);
    }

    async function readRecords(tableForRead, columns) {
      const rows = [];
      let lastId;
      while (true) {
        let query = tableForRead().select(columns).order('id').limit(500);
        if (lastId !== undefined) query = query.gt('id', lastId);
        const page = result(await query);
        if (!page.length) return rows;
        rows.push(...page);
        lastId = page[page.length - 1].id;
      }
    }

    return {
      suppliers: {
        subscribe: (onChange, onStatus) => subscribe('suppliers:shared', onChange, onStatus),
        read: () => readRecords(supplierTable, supplierFields),
        async save(values, id) {
          const query = id ? supplierTable().update(values).eq('id', id) : supplierTable().insert(values);
          return result(await query.select(supplierFields).single());
        },
        async remove(id) {
          result(await supplierTable().delete().eq('id', id).select('id').single());
        },
        async import(records) {
          return result(await supplierTable().upsert(records, {
            onConflict: 'source_key',
            ignoreDuplicates: true
          }).select(supplierFields));
        }
      },
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
      subscribe: (onChange, onStatus) => subscribe('calendar:shared', onChange, onStatus),
      read: () => readRecords(table, fields),
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
