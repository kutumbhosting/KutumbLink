import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderPlus, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Phone, MapPin, Facebook, Instagram, Twitter } from "lucide-react";

const DEFAULT_BANK_FOLDER = "https://drive.google.com/drive/folders/1wo2VFMi_2zZQSeQbJgFBSqBXS5enTCME";
const DEFAULT_MEDIA_FOLDER = "https://drive.google.com/drive/folders/1xWnGVgBdTIuBFD2Gj8JjT0y0QgMJijJf";

const Footer = () => {
  const currentYear = new Date().getFullYear();
  // Drop box folders come from Admin → Settings (defaults until loaded).
  const [links, setLinks] = useState<{ bankFolderUrl: string; mediaFolderUrl: string; suggestedFolderNames: string[] }>({
    bankFolderUrl: DEFAULT_BANK_FOLDER,
    mediaFolderUrl: DEFAULT_MEDIA_FOLDER,
    suggestedFolderNames: [],
  });
  const [mediaPromptOpen, setMediaPromptOpen] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/drop-box-links")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLinks((l) => ({ ...l, ...d })))
      .catch(() => {});
  }, []);

  const copyName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(name);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard not available — they can type it */
    }
  };

  return (
    <footer className="bg-gradient-to-b from-muted to-background border-t border-border">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 mb-8">
          {/* About Section */}
          <div>
          <div className="flex items-center gap-2 mb-4">
             <span className="text-lg font-bold tracking-tight text-foreground">Kutumb<span className="text-primary">Link</span></span>
           </div>    
           <Link to="/" onClick={() => window.scrollTo(0, 0)}
              className="text-muted-foreground hover:text-primary transition-colors text-sm">
              Building stronger communities through social impact, engagement, and compassion.
           </Link>
           <div className="flex gap-6 mt-4">
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <Facebook size={20} />
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <Instagram size={20} />
              </a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                <Twitter size={20} />
              </a>
           </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/about" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/executive" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">
                  Executive Team
                </Link>
              </li>
              <li>
                <Link to="/activities" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">
                  Activities
                </Link>
              </li>
              <li>
                <Link to="/events" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">
                  Events
                </Link>
              </li>
              <li>
                <Link to="/checkin" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">
                  Check-in
                </Link>
              </li>
              <li>
                {/* A plain link (not a router Link): /user-manual is a PDF
                    served by the server, not a page of this app. Public — no
                    login needed. */}
                <a
                  href="/user-manual"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  User Manual
                </a>
              </li>
            </ul>
          </div>

          {/* Get Involved */}
          <div>
            <h3 className="font-semibold mb-4">Get Involved</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/membership" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">
                  Become a Member
                </Link>
              </li>
              <li>
                <Link to="/events" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">
                  Register for Events
                </Link>
              </li>
              <li>
                <Link to="/contact" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">
                  Contact Us
                </Link>
              </li>
              <li>
                <Link
                  to="/admin"
                  onClick={() => window.scrollTo(0, 0)}
                  className="text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  Admin
                </Link>
              </li>
              {/* Google Drive drop boxes (kutumbhosting@gmail.com). Access is
                  controlled by the folders' own Drive sharing, not by the site. */}
              <li>
                <a
                  href={links.bankFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  Bank File Drop Box
                </a>
              </li>
              <li>
                {/* Asks people to use an event-named folder before opening the drop box. */}
                <button
                  type="button"
                  onClick={() => setMediaPromptOpen(true)}
                  className="text-muted-foreground hover:text-primary transition-colors text-sm text-left"
                >
                  Event Media Drop Box
                </button>
              </li>

            </ul>
          </div>

          {/* Legal Centre */}
          <div>
            <h3 className="font-semibold mb-4">Legal Centre</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/privacy"
                  onClick={() => window.scrollTo(0, 0)}
                  className="text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  Privacy and cookie policy
                </Link>
              </li>
              <li>
                <Link
                  to="/terms"
                  onClick={() => window.scrollTo(0, 0)}
                  className="text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  Terms of use
                </Link>
              </li>
              <li><Link to="/organiser-terms" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">Organiser terms</Link></li>
              <li><Link to="/privacy-choices" onClick={() => window.scrollTo(0, 0)} className="text-muted-foreground hover:text-primary transition-colors text-sm">Your privacy choices</Link></li>
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="font-semibold mb-4">Contact</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin size={16} className="mt-1 flex-shrink-0 text-primary" />
                <span>Sydney, New South Wales, Australia</span>
              </li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone size={16} className="flex-shrink-0 text-primary" />
                <span>+61 412 830 048</span>
              </li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail size={16} className="flex-shrink-0 text-primary" />
                <span>info@kutumb.org.au</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-border pt-8 mt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
            <p>© Kutumb Australia, {currentYear}. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <Link
                to="/privacy"
                onClick={() => window.scrollTo(0, 0)}
                className="hover:text-primary transition-colors"
              >
                Privacy and cookie policy
              </Link>
              <span className="text-border">|</span>
              <Link
                to="/terms"
                onClick={() => window.scrollTo(0, 0)}
                className="hover:text-primary transition-colors"
              >
                Terms of use
              </Link>
              <span className="text-border">|</span>
              <Link to="/organiser-terms" onClick={() => window.scrollTo(0, 0)} className="hover:text-primary transition-colors">Organiser terms</Link>
              <span className="text-border">|</span>
              <Link to="/privacy-choices" onClick={() => window.scrollTo(0, 0)} className="hover:text-primary transition-colors">Your privacy choices</Link>
            </div>
<p className="text-right md:ml-auto">
  Developed by{" "}
  <a
    href="https://www.prama-ai.com"
    target="_blank"
    rel="noopener noreferrer"
    className="text-primary font-semibold hover:underline"
  >
    Prama AI
  </a>
</p>
          </div>
        </div>
      </div>
          <Dialog open={mediaPromptOpen} onOpenChange={setMediaPromptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="w-5 h-5 text-primary" /> Before you upload
            </DialogTitle>
            <DialogDescription>
              Please keep each event's photos and videos together in a folder named after the event.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            <li>Open the drop box (button below).</li>
            <li>
              If there's already a folder for your event, <strong>open it</strong>. If not, click{" "}
              <strong>New → New folder</strong> and name it after the event, for example{" "}
              <em>{links.suggestedFolderNames[0] || "Utsav Multicultural Festival 2026"}</em>.
            </li>
            <li>
              Drop your images and videos <strong>inside that event folder</strong> — please don't leave files loose in
              the main folder.
            </li>
          </ol>
          {links.suggestedFolderNames.length > 0 && (
            <div className="text-sm">
              <p className="font-medium mb-1">Event folder names (tap to copy):</p>
              <div className="flex flex-wrap gap-2">
                {links.suggestedFolderNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => copyName(name)}
                    className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-muted"
                  >
                    <Copy className="w-3 h-3" /> {copied === name ? "Copied!" : name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            You'll need to sign in with the Google account the folder has been shared with.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setMediaPromptOpen(false)}>Cancel</Button>
            <Button asChild onClick={() => setMediaPromptOpen(false)}>
              <a href={links.mediaFolderUrl} target="_blank" rel="noopener noreferrer">
                OK — open the drop box
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </footer>
  );
};

export default Footer;


