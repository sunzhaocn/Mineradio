package dev.mineradio.android;

import android.util.Base64;
import java.io.*;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Bounded blob transfer into app cache; only the system picker chooses a destination. */
final class ExportStore {
    static final class Entry {
        final String id, name, mime;
        final File file;
        long bytes;
        boolean finished;
        Entry(String name,String mime) throws IOException {
            id=UUID.randomUUID().toString();
            this.name=name.replaceAll("[\\p{Cntrl}/\\\\]","_");
            this.mime=mime.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")?mime:"application/octet-stream";
            File directory=new File(MineradioApp.app.getCacheDir(),"exports");directory.mkdirs();
            file=new File(directory,id+".tmp");if(!file.createNewFile())throw new IOException();
        }
    }
    private static final ConcurrentHashMap<String,Entry> entries=new ConcurrentHashMap<>();
    static String begin(String name,String mime){try{if(name.length()>220)name=name.substring(0,220);Entry value=new Entry(name,mime);entries.put(value.id,value);return value.id;}catch(Exception error){return "";}}
    static boolean append(String id,String encoded){
        Entry value=entries.get(id);if(value==null||encoded.length()>100000)return false;
        synchronized(value){try{
            if(value.finished)return false;
            byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);
            if(value.bytes+bytes.length>512L*1024*1024)return false;
            try(OutputStream out=new FileOutputStream(value.file,true)){out.write(bytes);}
            value.bytes+=bytes.length;return true;
        }catch(Exception error){return false;}}
    }
    static void finish(String id){Entry value=entries.get(id);if(value==null)return;value.finished=true;
        MineradioApp.app.main.post(()->{MainActivity activity=MainActivity.current.get();if(activity!=null&&!activity.isFinishing())activity.offerBlobSave(value);else release(id);});
    }
    static void release(String id){Entry value=entries.remove(id);if(value!=null)value.file.delete();}
}
